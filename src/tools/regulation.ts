/**
 * Regulation surface — versioned per source document.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import type { Regulation } from "../schema.ts";
import { ProvisionKindSchema, RegulationSchema, regulationIdSchema } from "../schema.ts";
import { rankedSearch, regulationSearchFields } from "../search.ts";
import {
  READ_ONLY_HINTS,
  lenient,
  miss,
  ok,
  paginate,
  searchInputShape,
  searchOutputShape,
  searchResult,
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
      if (detail === "full") return searchResult(paginate(records.map(capCommentary), limit, offset));
      // The adapter interface returns records only — recompute matches locally
      // (cheap at result sizes) to attach the excerpt to each concise hit.
      const matches = rankedSearch(records, query, regulationSearchFields(query), records.length);
      const excerpts = new Map(matches.map((m) => [m.record.id, m.matched.excerpt]));
      const concise = records.map((r) => {
        const excerpt = excerpts.get(r.id);
        return {
          id: r.id,
          citation: r.citation,
          ...(excerpt !== undefined ? { matched_excerpt: excerpt } : {}),
          document_id: r.document_id,
          ...(r.parent !== undefined ? { parent: r.parent } : {}),
          ...(r.kind !== undefined ? { kind: r.kind } : {}),
          ...(r.obligation !== undefined ? { obligation: r.obligation } : {}),
        };
      });
      return searchResult(paginate(concise, limit, offset));
    },
  );

  server.registerTool(
    "get_regulation",
    {
      title: "Get regulation",
      description:
        "Fetch one regulation paragraph by URI. Returns the full record: citation, verbatim " +
        "text, and attached commentary (supervisor Q&A, interpretive letters). Latest version " +
        "by default; pass as_of (ISO date) for the text in force on that date — backends " +
        "without history for the id serve the current text, and an as_of predating every " +
        "recorded version is a miss, never current text as historical. Unknown ids return " +
        "isError with a pointer. Use get_referrers to find operationalising checks/playbooks.",
      inputSchema: {
        id: lenient(regulationIdSchema).describe(
          "A regulation id from search_regulation or resolve_citation — shape regulation://{document}/{provision}",
        ),
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01"),
      },
      outputSchema: RegulationSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, as_of }) => {
      const record = await adapters.regulation.get(id, as_of);
      if (record !== null) return ok(record);
      if (as_of !== undefined && (await adapters.regulation.get(id)) !== null) {
        return miss(
          `No version of ${id} was in force on ${as_of} according to this corpus's history. ` +
            "Historical coverage rule: as_of resolves against recorded versions only — a date " +
            "predating every recorded version returns nothing (backends without history for an " +
            "id always serve the current text). Retry without as_of for the current text.",
        );
      }
      return miss(`No record for ${id}. Verify the id with search_regulation or list_review_areas.`);
    },
  );
}
