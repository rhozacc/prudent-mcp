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
        "Full-text search across all loaded regulatory frameworks. Returns an array of " +
        "Regulation records — each with id, citation, text, commentary. Latest versions only. " +
        "Use get_referrers on any returned id to find the checks and playbooks that operationalise it. " +
        "For historical versions, use get_regulation with as_of.",
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
        "Fetch a regulation paragraph by URI. Returns citation, verbatim text, and attached " +
        "commentary (supervisor Q&A, interpretive letters). Latest version by default; pass " +
        "as_of (ISO date) for the text in force on a given date — e.g. as_of: '2019-03-01' " +
        "to see what CRR said when a model was built. Use get_referrers on the id to find " +
        "which checks and playbooks operationalise this article.",
      inputSchema: {
        id: regulationIdSchema.describe("e.g. regulation://crr/178/1/a"),
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01"),
      },
    },
    async ({ id, as_of }) => asJson(await adapters.regulation.get(id, as_of)),
  );
}
