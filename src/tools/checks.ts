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
      description:
        "Full-text search across the catalog of qualitative checks. Returns id, name, " +
        "derived_from (RegulationId[] this check operationalises), expectation, and " +
        "expected_evidence (artifacts the reviewer must gather). " +
        "Call get_check for the full record, or get_regulation on any derived_from id " +
        "to read the underlying law.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => asJson(await adapters.check.search(query)),
  );

  server.registerTool(
    "get_check",
    {
      description:
        "Fetch a check by ID. Returns name, expectation (concrete pass/fail bar), " +
        "derived_from (RegulationId[] this check operationalises), and expected_evidence " +
        "(list of artifacts the reviewer must gather). Use get_regulation on any " +
        "derived_from id to read the underlying law.",
      inputSchema: { id: checkIdSchema },
    },
    async ({ id }) => asJson(await adapters.check.get(id)),
  );
}
