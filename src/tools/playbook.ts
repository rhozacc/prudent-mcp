/**
 * `playbook`: one playbook rendered, or one requirement with the full text of its provisions.
 *
 * The rendering is deterministic (src/render.ts): citations are the provisions' official citations, the body carries no
 * ids, each source is labelled with its force and market practice says so. Notes carry any recorded amendment to a
 * provision the playbook relies on.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { citationOf, sourceFor } from "../citation-style.ts";
import { renderPlaybook } from "../render.ts";
import { playbookProvisions } from "../referrers.ts";
import type { Playbook } from "../schema.ts";
import { mergeNotes, notesShape, type Note } from "./notes.ts";
import { pendingNoteFor } from "./pending.ts";
import { servedPlaybookContext } from "./playbook-context.ts";
import { READ_ONLY_HINTS, miss, stripEdgeNoise } from "./shared.ts";

/** Amendment notes for the provisions a playbook cites (at most `limit` provisions are checked, each once). */
export async function playbookNotes(pb: Playbook, ctxSources?: Awaited<ReturnType<typeof servedPlaybookContext>>): Promise<Note[]> {
  const ctx = ctxSources ?? (await servedPlaybookContext());
  const notes: Note[] = [];
  for (const id of playbookProvisions(pb)) {
    const reg = ctx.regulations.get(id);
    if (reg === undefined) continue;
    const text = await pendingNoteFor(reg);
    if (text !== undefined) notes.push({ type: "amendment", text, applies_to: [citationOf(reg, sourceFor(reg, ctx.sources))] });
  }
  return mergeNotes(notes);
}

/** Notes as the plain lines a model reads at the end of a text answer. */
export function notesText(notes: readonly Note[]): string {
  if (notes.length === 0) return "";
  return ["## Notes", ...notes.map((n) => `- ${n.text}${n.applies_to === undefined || n.applies_to.length === 0 ? "" : ` (${n.applies_to.join("; ")})`}`)].join("\n");
}

export const slugOf = (id: string): string => id.replace(/^playbook:\/\//, "");

export function registerPlaybookTool(server: McpServer): void {
  server.registerTool(
    "playbook",
    {
      title: "Playbook",
      description:
        "A whole playbook for one topic as text: what it rests on (law, EBA guideline, ECB supervisory expectation, each labelled), what has to be " +
        "shown, methods (market practice is labelled as such), pitfalls, and what the library does not hold. With section (R1, R2, …) one " +
        "requirement with the full text of its provisions. Ids come from topics and brief.",
      inputSchema: {
        id: z.string().describe("A playbook id from topics or brief (the full id or just the name after the scheme)."),
        section: z.string().regex(/^R\d+$/).optional().describe("A requirement handle: R1, R2, …"),
      },
      outputSchema: z
        .object({ id: z.string(), title: z.string(), status: z.string(), requirements: z.array(z.object({ id: z.string(), title: z.string() })), abridged: z.array(z.string()).optional(), ...notesShape })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id: raw, section }) => {
      const cleaned = stripEdgeNoise(raw);
      const id = cleaned.startsWith("playbook://") ? cleaned : `playbook://${cleaned}`;
      const pb = await adapters.playbook.get(id as never);
      if (pb === null) {
        const all = await adapters.playbook.list();
        return miss(`This library has no playbook with the id ${id}. Available: ${all.map((p) => slugOf(p.id)).join(", ") || "none"}. topics lists them with titles.`);
      }
      const ctx = await servedPlaybookContext();
      const rendered = renderPlaybook(pb, ctx, section === undefined ? {} : { section });
      if (rendered === null) return miss(`${pb.title} has no requirement ${section}. Its requirements are ${pb.requirements.map((r) => r.id).join(", ")}.`);
      const notes = await playbookNotes(pb, ctx);
      const text = [rendered.text, notesText(notes)].filter((t) => t !== "").join("\n\n");
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          id: pb.id,
          title: pb.title,
          status: pb.provenance.status,
          requirements: pb.requirements.map((r) => ({ id: r.id, title: r.title })),
          ...(rendered.abridged.length > 0 ? { abridged: rendered.abridged } : {}),
          ...(notes.length > 0 ? { notes } : {}),
        },
      };
    },
  );
}
