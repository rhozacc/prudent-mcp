/**
 * `get`: open up to 20 entries by id, whatever they are.
 *
 * Provisions, checks, tests and sources in one call. A provision is served under `as_of` through the one resolution in
 * shared.ts; a version note, an amendment note and a placeholder note ride on the provisions they concern, merged so that
 * a caveat shared by several says so once. A page that would exceed the size ceiling is shortened (commentary first, then
 * trailing entries) and says what it left out; nothing is dropped silently.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { computeHoldings, missingRecordClause } from "../holdings.ts";
import type { Regulation, RegulationId } from "../schema.ts";
import { mergeNotes, notesShape, provisionNotes, withNotes, type Note } from "./notes.ts";
import { AS_OF_MISS_CONTEXT, RESPONSE_CHAR_BUDGET, READ_ONLY_HINTS, miss, ok, resolveRegulation, serialize, stripEdgeNoise } from "./shared.ts";

const MAX_IDS = 20;
const MAX_COMMENTARY = 3;

const idsInput = z
  .union([z.string(), z.array(z.string())])
  .describe("One id or up to 20: provisions, checks, tests or sources, as search and related return them.");

type Entry = Record<string, unknown>;

function capCommentary(r: Regulation): Entry {
  if (r.commentary.length <= MAX_COMMENTARY) return r as unknown as Entry;
  return { ...r, commentary: r.commentary.slice(0, MAX_COMMENTARY), commentary_omitted: r.commentary.length - MAX_COMMENTARY };
}

async function missingWhy(id: string): Promise<string> {
  if (id.startsWith("regulation://")) {
    const [regulations, sources] = await Promise.all([adapters.regulation.list(), adapters.source.list()]);
    return missingRecordClause(regulations, computeHoldings(regulations, sources), id);
  }
  if (id.startsWith("playbook://")) return "That is a playbook: open it with playbook.";
  return "This library holds no entry with that id; find one with search.";
}

export function registerGetTool(server: McpServer): void {
  server.registerTool(
    "get",
    {
      title: "Get",
      description:
        "Open entries by id: full provisions (verbatim text, commentary), checks, tests, sources. Up to 20 per call. " +
        "as_of (ISO date) gives a provision's text in force on that date; where the library holds no version for it the current text " +
        "comes back with a version note and is not evidence of what applied then. Notes also flag a recorded amendment and a " +
        "pre-adoption placeholder: repeat them with the text. Playbooks are opened with playbook.",
      inputSchema: {
        ids: idsInput,
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01. Provisions only."),
      },
      outputSchema: z
        .object({
          records: z.array(z.object({ id: z.string() }).passthrough()),
          missing: z.array(z.object({ id: z.string(), why: z.string() })).optional(),
          notice: z.string().optional(),
          ...notesShape,
        })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ ids: raw, as_of }) => {
      const ids = [...new Set((Array.isArray(raw) ? raw : [raw]).map(stripEdgeNoise).filter((x) => x !== ""))];
      if (ids.length === 0) return miss("Give at least one id (a provision, check, test or source).");
      if (ids.length > MAX_IDS) return miss(`Ask for at most ${MAX_IDS} ids at a time; got ${ids.length}.`);

      const records: Entry[] = [];
      const missing: Array<{ id: string; why: string }> = [];
      const notes: Note[] = [];
      let asOfMissed = false;

      for (const id of ids) {
        if (id.startsWith("regulation://")) {
          const served = await resolveRegulation(id as RegulationId, as_of);
          if (served.record === null) {
            if (served.noVersion) {
              asOfMissed = true;
              missing.push({ id, why: `This library has no version of this provision in force on ${as_of}. ${AS_OF_MISS_CONTEXT}` });
            } else missing.push({ id, why: await missingWhy(id) });
            continue;
          }
          records.push(capCommentary(served.record));
          notes.push(...(await provisionNotes(served.record, { asOf: as_of, versionNote: served.note })));
        } else if (id.startsWith("check://")) {
          const c = await adapters.check.get(id as never);
          if (c === null) missing.push({ id, why: await missingWhy(id) });
          else records.push(c as unknown as Entry);
        } else if (id.startsWith("test://")) {
          const t = await adapters.test.get(id as never);
          if (t === null) missing.push({ id, why: await missingWhy(id) });
          else records.push(t as unknown as Entry);
        } else if (id.startsWith("source://")) {
          const s = await adapters.source.get(id as never);
          if (s === null) missing.push({ id, why: await missingWhy(id) });
          else records.push(s as unknown as Entry);
        } else {
          missing.push({ id, why: await missingWhy(id) });
        }
      }

      if (records.length === 0) {
        const said = missing.map((m) => (m.id.startsWith("regulation://") && !m.why.startsWith("This library has no version") ? `No provision has the id ${m.id}. ${m.why}` : `${m.id}: ${m.why}`));
        return miss(`${said.join(" ")} ${asOfMissed ? "Retry without as_of for the current text." : "Verify the id with search or cite."}`);
      }

      // Shorten to fit: drop trailing records until the page is under the ceiling; the rest are listed as not shown.
      let shown = records;
      while (shown.length > 1 && serialize(shown).length > RESPONSE_CHAR_BUDGET) shown = shown.slice(0, Math.max(1, Math.floor(shown.length / 2)));
      const left = records.slice(shown.length).map((r) => String(r.id));
      const body: Record<string, unknown> = {
        records: shown,
        ...(missing.length > 0 ? { missing } : {}),
        ...(left.length > 0 ? { notice: `Showing ${shown.length} of ${records.length} to keep this response short. Ask again for: ${left.join(", ")}.` } : {}),
      };
      const shownIds = new Set(shown.map((r) => String(r.id)));
      const kept = mergeNotes(notes).filter((n) => n.applies_to === undefined || shownIds.size > 0);
      return ok(withNotes(body, kept));
    },
  );
}
