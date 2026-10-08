/**
 * `search`: ranked passages, provisions by default.
 *
 * One tool where 0.x had four. `scope` picks the surface (provisions, checks, tests or playbooks); the envelope is the 0.x
 * one (`total_matches`, `next_offset`, `best_coverage`, a row's `coverage`) and a weak best match is a `weak_match` note.
 * Provisions marked background are never searched. `document` narrows provisions to one document.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { citationOf, sourceFor } from "../citation-style.ts";
import {
  checkSearchFields,
  playbookSearchFields,
  regulationRanking,
  regulationSearchFields,
  testSearchFields,
} from "../search.ts";
import { pendingPageNotice } from "./pending.ts";
import { READ_ONLY_HINTS, firstSentence, rankedSearchResult, rowCoverageShape, searchGlossary, searchInputShape, searchOutputShape } from "./shared.ts";

const Row = z.object({ id: z.string(), ...rowCoverageShape }).passthrough();

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Ranked passages for a specific question or wording. Provisions by default (scope: provisions); checks, tests and playbooks " +
        "by scope. Rows carry an official citation and a quotable excerpt; quote the excerpt rather than reopening the provision. " +
        "total_matches is every match, not the page: page with next_offset. Read best_coverage and each row's coverage (out of " +
        "query_tokens) before treating the top row as an answer; a weak_match note says the topic may not be in the library.",
      inputSchema: {
        ...searchInputShape("citation, heading path, text and commentary of provisions"),
        scope: z
          .enum(["provisions", "checks", "tests", "playbooks"])
          .default("provisions")
          .describe("Which kind of entry to search."),
        document: z
          .string()
          .optional()
          .describe("Provisions only: restrict to one document by its id (as sources lists them)."),
      },
      outputSchema: searchOutputShape(Row),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail, scope, document }) => {
      const glossary = await searchGlossary();
      const common = { query, detail, limit, offset } as const;

      if (scope === "checks") {
        const records = await adapters.check.search(query);
        return rankedSearchResult({
          ...common,
          records,
          fields: checkSearchFields,
          options: { glossary },
          concise: (c, m) => ({ id: c.id, name: c.name, expectation: firstSentence(c.expectation), ...(m?.matched.excerpt === undefined ? {} : { matched_excerpt: m.matched.excerpt }) }),
        });
      }
      if (scope === "tests") {
        const records = await adapters.test.search(query);
        return rankedSearchResult({
          ...common,
          records,
          fields: testSearchFields,
          options: { glossary },
          concise: (t, m) => ({ id: t.id, name: t.name, purpose: firstSentence(t.purpose), ...(m?.matched.excerpt === undefined ? {} : { matched_excerpt: m.matched.excerpt }) }),
        });
      }
      if (scope === "playbooks") {
        const records = await adapters.playbook.search(query);
        return rankedSearchResult({
          ...common,
          records,
          fields: playbookSearchFields,
          options: { glossary },
          concise: (p) => ({ id: p.id, title: p.title, summary: firstSentence(p.summary) }),
        });
      }

      const found = await adapters.regulation.search(query);
      const records = document === undefined ? found : found.filter((r) => r.document_id === document);
      const sources = await adapters.source.list();
      const pageNotice = await pendingPageNotice(records);
      return rankedSearchResult({
        ...common,
        records,
        pageNotice,
        fields: regulationSearchFields(query),
        options: regulationRanking({ scope: "default", glossary }),
        concise: (r, m) => ({
          id: r.id,
          citation: citationOf(r, sourceFor(r, sources)),
          ...(m?.matched.excerpt === undefined ? {} : { matched_excerpt: m.matched.excerpt }),
          document_id: r.document_id,
          ...(r.kind !== undefined ? { kind: r.kind } : {}),
          ...(r.obligation !== undefined ? { obligation: r.obligation } : {}),
        }),
      });
    },
  );
}
