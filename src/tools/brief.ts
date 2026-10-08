/**
 * `brief`: the first call for a substantive question.
 *
 * It routes the question to the playbook that answers it (src/brief.ts), renders that playbook within a budget, and appends
 * what the playbook does not carry: the provisions the question lands on that it does not cite, neighbouring playbooks, and
 * the notes that must travel with the answer. When no playbook clears the floor it says so and returns the passages the
 * question found, grouped by document, with a note when even the best of them matches little of the question.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { ROUTING, routePlaybooks, type Route } from "../brief.ts";
import { citationOf, sourceFor } from "../citation-style.ts";
import { playbookProvisions } from "../referrers.ts";
import { renderPlaybook } from "../render.ts";
import type { Regulation } from "../schema.ts";
import { distinctQueryTokens, rankedSearch, rankingOf, regulationRanking, regulationSearchFields } from "../search.ts";
import { mergeNotes, notesShape, provisionNotes, type Note } from "./notes.ts";
import { notesText, playbookNotes, slugOf } from "./playbook.ts";
import { servedPlaybookContext } from "./playbook-context.ts";
import { READ_ONLY_HINTS, miss, searchGlossary, weakMatchNotice } from "./shared.ts";

const BUDGETS = { short: 2500, standard: 5000, long: 9000 } as const;
/** Share of the budget the playbook itself may take; the rest is for what it does not carry and the notes. */
const PLAYBOOK_SHARE = 0.72;
const ALSO_RELEVANT = { short: 3, standard: 5, long: 5 } as const;
const PASSAGES = 8;

export function registerBriefTool(server: McpServer): void {
  server.registerTool(
    "brief",
    {
      title: "Brief",
      description:
        "Call this first for any substantive question about IRB credit-risk regulation or supervisory practice. Returns the playbook that " +
        "answers it (what it rests on, what has to be shown, pitfalls), the provisions that matter but the playbook does not cite, " +
        "neighbouring playbooks and notes. When no playbook fits it says so and returns the best passages. Open more with playbook, " +
        "search, get, cite and related. Repeat the notes with the answer.",
      inputSchema: {
        question: z.string().min(3).describe("The question in the user's own words, abbreviations and all."),
        as_of: z.string().date().optional().describe("ISO date, when the question is about the text in force on a past day."),
        budget: z.enum(["short", "standard", "long"]).default("standard").describe("Response size: about 2.5k, 5k or 9k tokens."),
      },
      outputSchema: z
        .object({
          playbook: z.object({ id: z.string(), title: z.string(), status: z.string() }).nullable(),
          confidence: z.object({ score: z.number(), text: z.number(), vote: z.number(), ambiguous: z.boolean() }).optional(),
          also_relevant: z.array(z.object({ id: z.string(), citation: z.string() })),
          other_playbooks: z.array(z.object({ id: z.string(), title: z.string() })),
          ...notesShape,
        })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ question, as_of, budget }) => {
      const playbooks = await adapters.playbook.list();
      const glossary = await searchGlossary();
      const found = await adapters.regulation.search(question);
      const ranking = regulationRanking({ scope: "default", glossary });
      const ranked = rankingOf(found) ?? rankedSearch(found, question, regulationSearchFields(question), undefined, ranking);
      const excerptOf = new Map(ranked.map((m) => [m.record.id as string, m] as const));
      const routing = routePlaybooks({ question, playbooks, rankedProvisions: found.slice(0, ROUTING.voteDepth).map((r) => r.id), glossary });
      const ctx = await servedPlaybookContext();
      const total = BUDGETS[budget];
      const cite = (r: Regulation): string => citationOf(r, sourceFor(r, ctx.sources));

      const notes: Note[] = [];
      const parts: string[] = [];
      const chosen: Route | null = routing.chosen;
      const cited = chosen === null ? new Set<string>() : new Set<string>([...playbookProvisions(chosen.playbook), ...chosen.playbook.excluded.map((e) => e.id)]);

      // Provisions the question lands on that the playbook does not carry (or, with no playbook, the best passages).
      const wanted = chosen === null ? PASSAGES : ALSO_RELEVANT[budget];
      const extra = found.filter((r) => r.kind !== "section" && !cited.has(r.id)).slice(0, wanted);
      const lines = (rs: Regulation[]): string[] =>
        rs.map((r) => {
          const ex = excerptOf.get(r.id)?.matched.excerpt;
          return `- ${cite(r)}${ex === undefined ? "" : `: "${ex.replace(/\s+/g, " ").trim()}"`}`;
        });

      if (chosen !== null) {
        const rendered = renderPlaybook(chosen.playbook, ctx, { budget: Math.round(total * PLAYBOOK_SHARE) });
        parts.push(rendered?.text ?? "");
        notes.push(...(await playbookNotes(chosen.playbook, ctx)));
        if (as_of !== undefined) {
          notes.push({ type: "version", text: `This playbook is written from the current text of each source. It is not evidence of what applied on ${as_of}; open the provisions with their date to read that text.` });
        }
        if (extra.length > 0) parts.push(["## Also relevant (not in the playbook)", ...lines(extra)].join("\n"));
        const others = routing.neighbours.map((r) => r.playbook);
        if (others.length > 0) {
          parts.push(
            [routing.ambiguous ? "## A close second" : "## Other playbooks", ...others.map((p) => `- ${p.title} (playbook "${slugOf(p.id)}")`)].join("\n"),
          );
        }
      } else {
        const tokens = distinctQueryTokens(question);
        const best = ranked.reduce<number | undefined>((b, m) => (b === undefined || m.coverage > b ? m.coverage : b), undefined);
        parts.push(
          playbooks.length === 0
            ? "This library has no playbooks yet. The passages below are the best matches for the question."
            : "No playbook answers this question directly. The best passages follow, grouped by document.",
        );
        const byDoc = new Map<string, Regulation[]>();
        for (const r of extra) byDoc.set(r.document_id, [...(byDoc.get(r.document_id) ?? []), r]);
        for (const [doc, rs] of byDoc) parts.push([`## ${ctx.sources.find((s) => s.document_id === doc)?.title ?? doc}`, ...lines(rs)].join("\n"));
        if (extra.length === 0) parts.push("Nothing in the library matches the question's terms. Not finding a match is a statement about what this library holds, not about the law.");
        else if (best !== undefined && tokens >= 2 && best * 2 < tokens) notes.push({ type: "weak_match", text: weakMatchNotice(best, tokens) });
      }

      for (const r of extra.slice(0, 3)) notes.push(...(await provisionNotes(r, { asOf: as_of })).filter((n) => n.type === "amendment" || n.type === "placeholder"));
      const merged = mergeNotes(notes);
      const text = [...parts, notesText(merged)].filter((t) => t !== "").join("\n\n");

      if (text.trim() === "") return miss("Nothing to return for that question.");
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          playbook: chosen === null ? null : { id: chosen.playbook.id, title: chosen.playbook.title, status: chosen.playbook.provenance.status },
          ...(chosen === null ? {} : { confidence: { score: round(chosen.score), text: round(chosen.text), vote: round(chosen.vote), ambiguous: routing.ambiguous } }),
          also_relevant: await Promise.all(extra.map(async (r) => ({ id: r.id, citation: cite(r) }))),
          other_playbooks: routing.neighbours.map((r) => ({ id: r.playbook.id, title: r.playbook.title })),
          ...(merged.length > 0 ? { notes: merged } : {}),
        },
      };
    },
  );
}

const round = (n: number): number => Math.round(n * 100) / 100;
