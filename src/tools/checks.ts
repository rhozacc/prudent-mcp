/**
 * Checks surface — qualitative checks with pass/fail criteria.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { CheckSchema, checkIdSchema, regulationIdSchema } from "../schema.ts";
import {
  READ_ONLY_HINTS,
  firstSentence,
  lenient,
  miss,
  ok,
  paginate,
  searchInputShape,
  searchOutputShape,
  searchResult,
} from "./shared.ts";

// Concise projection served by search_checks (detail: "concise").
const ConciseCheckHit = z.object({
  id: checkIdSchema,
  name: z.string(),
  expectation_first_sentence: z.string(),
  derived_from: z.array(regulationIdSchema).describe("Regulations this check operationalises"),
}).passthrough();

export function registerCheckTools(server: McpServer): void {
  server.registerTool(
    "search_checks",
    {
      title: "Search checks",
      description:
        "Ranked, field-scoped search over the catalog of qualitative checks: name, " +
        "expectation, expected_evidence. Returns { results, total_matches, offset, truncated }; " +
        "concise results (default) are { id, name, expectation_first_sentence, derived_from } — " +
        "pass detail: 'full' for complete records. Call get_check on an id for the full record, " +
        "or get_regulation on any derived_from id to read the underlying law.",
      inputSchema: searchInputShape("name, expectation, and expected evidence"),
      outputSchema: searchOutputShape(z.union([ConciseCheckHit, CheckSchema])),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.check.search(query);
      if (detail === "full") return searchResult(paginate(records, limit, offset));
      const concise = records.map((c) => ({
        id: c.id,
        name: c.name,
        expectation_first_sentence: firstSentence(c.expectation),
        derived_from: c.derived_from,
      }));
      return searchResult(paginate(concise, limit, offset));
    },
  );

  server.registerTool(
    "get_check",
    {
      title: "Get check",
      description:
        "Fetch one check by ID. Returns the full record: name, expectation (concrete " +
        "pass/fail bar), derived_from (RegulationId[] this check operationalises), and " +
        "expected_evidence (artifacts the reviewer must gather). Unknown ids return isError " +
        "with a pointer. Use get_regulation on any derived_from id to read the underlying law.",
      inputSchema: {
        id: lenient(checkIdSchema).describe(
          "A check id from search_checks, get_area_overview or a playbook reference — shape check://{document}/{slug}",
        ),
      },
      outputSchema: CheckSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id }) => {
      const record = await adapters.check.get(id);
      if (record === null) return miss(`No record for ${id}. Verify the id with search_checks or list_review_areas.`);
      return ok(record);
    },
  );
}
