/**
 * Tests surface — statistical tests described, not executed.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { TestSchema, testIdSchema } from "../schema.ts";
import { testSearchFields } from "../search.ts";
import {
  COVERAGE_CARD,
  READ_ONLY_HINTS,
  firstSentence,
  lenient,
  miss,
  ok,
  rankedSearchResult,
  rowCoverageShape,
  searchInputShape,
  searchOutputShape,
} from "./shared.ts";

// Concise projection served by search_tests (detail: "concise").
const ConciseTestHit = z.object({
  id: testIdSchema,
  name: z.string(),
  family: z.string().optional().describe("Equivalence group across bank-specific variants"),
  purpose_first_sentence: z.string(),
  ...rowCoverageShape,
}).passthrough();

export function registerTestTools(server: McpServer): void {
  server.registerTool(
    "search_tests",
    {
      title: "Search tests",
      description:
        "Ranked, field-scoped search over the catalog of described statistical tests: name, " +
        "aliases, family, purpose, acceptance_criteria — useful for matching bank-specific " +
        "test names to corpus entries. Returns { results, total_matches, offset, truncated }; " +
        "concise results (default) are { id, name, family, purpose_first_sentence } — pass " +
        "detail: 'full' for complete records. Call get_test on an id for the full record. " + COVERAGE_CARD,
      inputSchema: searchInputShape("name, aliases, family, purpose, and acceptance criteria"),
      outputSchema: searchOutputShape(z.union([ConciseTestHit, TestSchema])),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.test.search(query);
      return rankedSearchResult({
        records,
        query,
        fields: testSearchFields,
        detail,
        limit,
        offset,
        concise: (t) => ({
          id: t.id,
          name: t.name,
          ...(t.family !== undefined ? { family: t.family } : {}),
          purpose_first_sentence: firstSentence(t.purpose),
        }),
      });
    },
  );

  server.registerTool(
    "get_test",
    {
      title: "Get test",
      description:
        "Fetch one test by ID. Returns the full record: name, family (equivalence group " +
        "across bank variants), aliases, purpose, acceptance_criteria, regulatory_basis. " +
        "Use family to reason about whether a bank-specific variant is acceptable; " +
        "computation happens elsewhere — this server only describes. Unknown ids return " +
        "isError with a pointer. Use get_referrers to find playbooks referencing the test.",
      inputSchema: {
        id: lenient(testIdSchema).describe(
          "A test id from search_tests or a playbook reference — shape test://{document}/{slug}",
        ),
      },
      outputSchema: TestSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id }) => {
      const record = await adapters.test.get(id);
      if (record === null) return miss(`No record for ${id}. Verify the id with search_tests or list_review_areas.`);
      return ok(record);
    },
  );
}
