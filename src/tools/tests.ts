/**
 * Tests surface — statistical tests described, not executed.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { testIdSchema } from "../schema.ts";

function asJson(v: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] };
}

export function registerTestTools(server: McpServer): void {
  server.registerTool(
    "search_tests",
    {
      description:
        "Full-text search across the catalog of described statistical tests. Matches name, " +
        "aliases, and purpose — useful for matching bank-specific test names to corpus entries. " +
        "Returns id, name, family (equivalence group), aliases, purpose, acceptance_criteria. " +
        "Call get_test for the full record.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.test.search(query)),
  );

  server.registerTool(
    "get_test",
    {
      description:
        "Fetch a test by ID. Returns name, family (equivalence group across bank variants), " +
        "aliases, purpose, and acceptance_criteria. Use family to reason about whether a " +
        "bank-specific variant is acceptable. Computation happens elsewhere; this server only " +
        "describes. Use get_referrers to find which playbooks reference this test.",
      inputSchema: { id: testIdSchema },
    },
    async ({ id }) => asJson(await adapters.test.get(id)),
  );
}
