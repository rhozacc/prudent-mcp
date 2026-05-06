/**
 * Checks surface — qualitative checks with pass/fail criteria.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { checkIdSchema } from "../schema.ts";

function asJson(v: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] };
}

export function registerCheckTools(server: McpServer): void {
  server.registerTool(
    "search_checks",
    {
      description: "Search the catalog of qualitative checks.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.check.search(query)),
  );

  server.registerTool(
    "get_check",
    {
      description: "Fetch a check by ID.",
      inputSchema: { id: checkIdSchema },
    },
    async ({ id }) => asJson(await adapters.check.get(id)),
  );
}
