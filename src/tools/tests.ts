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
      description: "Search the catalog of described statistical tests.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.test.search(query)),
  );

  server.registerTool(
    "get_test",
    {
      description:
        "Fetch a test by ID — what it measures, when to use it, how to read its output. " +
        "Computation happens elsewhere; this server only describes.",
      inputSchema: { id: testIdSchema },
    },
    async ({ id }) => asJson(await adapters.test.get(id)),
  );
}
