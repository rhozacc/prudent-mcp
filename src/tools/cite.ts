/**
 * `cite`: a loose citation in prose to the provision it names, or an honest refusal.
 *
 * The resolver is the one in src/citation/ and is unchanged: exact matching in a fixed order, no fuzzy fallback, a
 * decline for an instrument the library does not hold. What changes is the envelope: the reason for a decline is a note
 * (`outside_library`) in the library's own words, and a match of an amended provision carries the amendment note.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { CitationResolutionSchema } from "../schema.ts";
import { applicabilityNote, notesShape, officialCitation, withNotes, type Note } from "./notes.ts";
import { pendingNoteFor } from "./pending.ts";
import { READ_ONLY_HINTS, ok } from "./shared.ts";

/** Candidates checked for a declaration; a citation that fits more than this many is vague enough already. */
const MAX_CANDIDATE_NOTES = 10;

export function registerCiteTool(server: McpServer): void {
  server.registerTool(
    "cite",
    {
      title: "Cite",
      description:
        "Resolve a citation as people write it (\"Art. 178(1)(a) CRR\", \"EBA GL 2017/16 para 78\", \"Chapter 3 paragraph 233\") to the " +
        "provision it names. Matching is exact; there is no fuzzy fallback. match is null when nothing matches, when several provisions " +
        "fit (candidates, ambiguous), or when the instrument is not in the library: an outside_library note says which, and whether a " +
        "document is held only in part. A null match is not a citation: never present one as though the text were found.",
      inputSchema: { text: z.string().describe("A citation in prose.") },
      outputSchema: CitationResolutionSchema.omit({ coverage_note: true }).extend({ official_citation: z.string().optional(), ...notesShape }).passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ text }) => {
      const { coverage_note, ...resolution } = await adapters.meta.resolveCitation(text);
      const notes: Note[] = [];
      let official: string | undefined;
      if (resolution.match !== null) {
        official = await officialCitation(resolution.match);
        const applies = await applicabilityNote(resolution.match.applicability, "provision", official);
        if (applies !== undefined) notes.push(applies);
        const amendment = await pendingNoteFor(resolution.match);
        if (amendment !== undefined) notes.push({ type: "amendment", text: amendment, applies_to: [official] });
      }
      // A candidate the citation might mean that is itself repealed or not yet in application: the caller is choosing
      // between provisions, and one of them should not be chosen unawares.
      for (const c of resolution.candidates.slice(0, MAX_CANDIDATE_NOTES)) {
        const candidate = await adapters.regulation.get(c.id);
        const applies = candidate === null ? undefined : await applicabilityNote(candidate.applicability, "provision", await officialCitation(candidate));
        if (applies !== undefined) notes.push(applies);
      }
      if (coverage_note !== undefined) notes.push({ type: "outside_library", text: coverage_note });
      return ok(withNotes({ ...resolution, ...(official === undefined ? {} : { official_citation: official }) }, notes));
    },
  );
}
