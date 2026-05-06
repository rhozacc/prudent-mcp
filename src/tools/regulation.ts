/**
 * Regulation surface — versioned per source document.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { regulationIdSchema } from "../schema.ts";

function asJson(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerRegulationTools(server: McpServer): void {
  server.registerTool(
    "search_regulation",
    {
      description:
        "Search across all loaded regulatory frameworks. Latest versions only. " +
        "For historical lookups, use get_regulation with as_of.",
      inputSchema: {
        query: z.string(),
      },
    },
    async ({ query }) => asJson(await adapters.regulation.search(query)),
  );

  server.registerTool(
    "get_regulation",
    {
      description:
        "Latest by default. Pass as_of for historical (e.g. 'what did CRR say " +
        "when this model was built in 2019').",
      inputSchema: {
        id: regulationIdSchema.describe("e.g. regulation://crr/178/1/a"),
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01"),
      },
    },
    async ({ id, as_of }) => asJson(await adapters.regulation.get(id, as_of)),
  );
}
