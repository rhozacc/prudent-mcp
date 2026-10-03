/**
 * Regulation surface — versioned per source document.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { MAX_PLACEHOLDER_SPANS, MAX_PLACEHOLDER_SPAN_CHARS, withPlaceholderFlag } from "../placeholders.ts";
import type { Regulation } from "../schema.ts";
import { ProvisionKindSchema, RegulationSchema, regulationIdSchema } from "../schema.ts";
import { regulationSearchFields } from "../search.ts";
import { pendingNoteFor, pendingPageNotice, withPendingNote } from "./pending.ts";
import {
  AS_OF_MISS_CONTEXT,
  READ_ONLY_HINTS,
  lenient,
  miss,
  ok,
  rankedSearchResult,
  resolveRegulation,
  rowCoverageShape,
  searchInputShape,
  searchOutputShape,
  unknownRegulationMiss,
  withAsOfNote,
} from "./shared.ts";

// Concise projection served by search_regulation (detail: "concise").
const ConciseRegulationHit = z.object({
  id: regulationIdSchema,
  citation: z.string(),
  matched_excerpt: z
    .string()
    .optional()
    .describe("Whole sentences around the best match — quotable as it stands."),
  document_id: z.string(),
  parent: regulationIdSchema.optional(),
  // Two fields worth ~20 characters between them and otherwise costing a fetch
  // each: whether this row is a section or the provision inside it, and whether
  // it states a requirement or guidance.
  kind: ProvisionKindSchema.optional(),
  obligation: z.enum(["must", "should", "may", "none"]).optional(),
  ...rowCoverageShape,
}).passthrough();

/**
 * Commentary a `detail: 'full'` search row carries before it starts crowding out
 * the answer.
 *
 * `Regulation.commentary` is unbounded by design — impact assessments and
 * consultation feedback attach to section records, and a handful of them carry
 * 40-56 entries. One such record serialized to 33,000 characters, so a single
 * row of a twenty-row page could not fit any sane response budget, and the
 * caller who asked for "full records" got one record and a notice.
 *
 * A search row's job is to let the caller decide what to open. So the record is
 * served whole except that commentary is capped, and `commentary_omitted` says
 * exactly how much was withheld and implies where to get it. Nothing served is
 * abridged: get_regulation on the id still returns every entry.
 */
const MAX_SEARCH_COMMENTARY = 3;

type FullRegulationRow = Regulation & { commentary_omitted?: number };

function capCommentary(r: Regulation): FullRegulationRow {
  if (r.commentary.length <= MAX_SEARCH_COMMENTARY) return r;
  return {
    ...r,
    commentary: r.commentary.slice(0, MAX_SEARCH_COMMENTARY),
    commentary_omitted: r.commentary.length - MAX_SEARCH_COMMENTARY,
  };
}

export function registerRegulationTools(server: McpServer): void {
  server.registerTool(
    "search_regulation",
    {
      title: "Search regulation",
      description:
        "Ranked, field-scoped search over regulation citation, text, and commentary " +
        "(record ids join in only for URI-like queries). Returns { results, returned, " +
        "total_matches, offset, truncated, next_offset, notice }; total_matches is the whole " +
        "match set, not this page. Concise results (default) are { id, citation, " +
        "matched_excerpt, document_id, parent }, the excerpt being whole sentences around the " +
        "match — quotable as it stands. detail: 'full' gives complete records with commentary " +
        "capped (commentary_omitted says how many were left out; get_regulation serves them " +
        "all). Latest versions only. Follow up with get_regulation (as_of for history) or " +
        "get_referrers on any id.",
      inputSchema: searchInputShape("citation, text, and commentary"),
      outputSchema: searchOutputShape(
        z.union([
          ConciseRegulationHit,
          RegulationSchema.extend({
            commentary_omitted: z
              .number()
              .int()
              .optional()
              .describe("Commentary entries withheld from this search row; get_regulation serves all of them."),
          }),
        ]),
      ),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.regulation.search(query);
      // Rows from a document with a change the corpus has not ingested say so once
      // per page, in `notice`; the note on each record is one get_regulation away.
      const pageNotice = await pendingPageNotice(records);
      // The excerpt comes from the same local ranking that supplies `coverage`.
      return rankedSearchResult({
        records,
        pageNotice,
        query,
        fields: regulationSearchFields(query),
        detail,
        limit,
        offset,
        full: capCommentary,
        concise: (r, match) => {
          const excerpt = match?.matched.excerpt;
          return {
            id: r.id,
            citation: r.citation,
            ...(excerpt !== undefined ? { matched_excerpt: excerpt } : {}),
            document_id: r.document_id,
            ...(r.parent !== undefined ? { parent: r.parent } : {}),
            ...(r.kind !== undefined ? { kind: r.kind } : {}),
            ...(r.obligation !== undefined ? { obligation: r.obligation } : {}),
          };
        },
      });
    },
  );

  server.registerTool(
    "get_regulation",
    {
      title: "Get regulation",
      description:
        "Fetch one regulation paragraph by URI. Returns the full record: citation, verbatim " +
        "text, and attached commentary (supervisor Q&A, interpretive letters). Latest version " +
        "by default; pass as_of (ISO date) for the text in force on that date, or the current text " +
        "with an as_of_note where no version is recorded for it. A registry-recorded change not yet ingested is " +
        "flagged: pending_changes_note. A pre-adoption placeholder act " +
        "number is flagged: pre_adoption_placeholders + notice. An as_of predating every recorded " +
        "version, or an unknown id, is an isError miss. get_referrers finds operationalising checks/playbooks.",
      inputSchema: {
        id: lenient(regulationIdSchema).describe(
          "A regulation id from search_regulation or resolve_citation — shape regulation://{document}/{provision}",
        ),
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01"),
      },
      // Open at the declaration site only: the canonical RegulationSchema stays
      // closed. `as_of_note` is published so a caller reading the schema learns
      // that a hit under as_of can carry a caveat about what it is. The placeholder
      // flag is declared here too and NOT on the `detail: 'full'` search rows above:
      // those rows are the canonical record schema served as it stands, and the flag
      // is one get_regulation away.
      outputSchema: RegulationSchema.extend({
        as_of_note: z
          .string()
          .optional()
          .describe(
            "Present only when as_of was given and the corpus records no version for that date, so the " +
              "current text was served. Says which version (document_version) and that it must not be " +
              "presented as the historical text.",
          ),
        pending_changes_note: z
          .string()
          .optional()
          .describe("A registry-recorded change to this document the corpus has not ingested."),
        pre_adoption_placeholders: z
          .array(z.string().max(MAX_PLACEHOLDER_SPAN_CHARS))
          .max(MAX_PLACEHOLDER_SPANS)
          .optional()
          .describe(
            "Present only when the text names an instrument by a pre-adoption placeholder number " +
              "(Regulation (EU) xx/xx): the matched spans. A placeholder is not a citation.",
          ),
        notice: z
          .string()
          .optional()
          .describe("Present with pre_adoption_placeholders: what the placeholder is and is not."),
      }).passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, as_of }) => {
      const { record, note } = await resolveRegulation(id, as_of);
      if (record !== null) {
        const pending = await pendingNoteFor(record, as_of);
        return ok(withAsOfNote(withPendingNote(withPlaceholderFlag(record), pending), note));
      }
      if (as_of !== undefined && (await adapters.regulation.get(id)) !== null) {
        return miss(
          `No version of ${id} was in force on ${as_of} according to this corpus's history. ` +
            "Historical coverage rule: as_of resolves against recorded versions only — a date " +
            `predating every recorded version returns nothing. ${AS_OF_MISS_CONTEXT} ` +
            "Retry without as_of for the current text.",
        );
      }
      return unknownRegulationMiss(id);
    },
  );
}
