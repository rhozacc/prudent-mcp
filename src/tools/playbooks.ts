/**
 * Playbooks surface — guided walkthroughs for review areas.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { playbookIdSchema } from "../schema.ts";

function asJson(v: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] };
}

export function registerPlaybookTools(server: McpServer): void {
  server.registerTool(
    "search_playbooks",
    {
      description: "Search the catalog of validation playbooks.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.playbook.search(query)),
  );

  server.registerTool(
    "get_playbook",
    {
      description: "Fetch a playbook by ID — area or area/subarea.",
      inputSchema: { id: playbookIdSchema },
    },
    async ({ id }) => asJson(await adapters.playbook.get(id)),
  );
}
