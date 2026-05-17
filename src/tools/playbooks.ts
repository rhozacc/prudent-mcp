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
      description:
        "Full-text search across the catalog of validation playbooks. Returns id, area, subarea. " +
        "Use get_playbook for the full record — ordered phases with mixed-surface references.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.playbook.search(query)),
  );

  server.registerTool(
    "get_playbook",
    {
      description:
        "Fetch a playbook by ID (area or area/subarea). Returns ordered phases, each with a " +
        "description and references array containing mixed regulation://, test://, check:// IDs. " +
        "Resolve each reference with get_regulation, get_test, or get_check.",
      inputSchema: { id: playbookIdSchema },
    },
    async ({ id }) => asJson(await adapters.playbook.get(id)),
  );
}
