/**
 * Playbooks surface — guided walkthroughs for review areas.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import type { Playbook, PlaybookId } from "../schema.ts";
import { PlaybookSchema, playbookIdSchema } from "../schema.ts";
import {
  READ_ONLY_HINTS,
  lenient,
  miss,
  ok,
  paginate,
  searchInputShape,
  searchOutputShape,
  searchResult,
} from "./shared.ts";

// Concise projection served by search_playbooks (detail: "concise").
const ConcisePlaybookHit = z.object({
  id: playbookIdSchema,
  area: z.string(),
  subarea: z.string().optional(),
  phase_count: z.number().int(),
}).passthrough();

/**
 * A playbook without its reference lists.
 *
 * "What are the steps" and "what does step 4 point at" are different
 * questions, and the record answers both at once: a dense playbook carries
 * ~90 regulation/test/check URIs across its phases plus a regulatory_scope of
 * a couple of hundred more, which is most of its bytes and none of the
 * walkthrough. Reference COUNTS stay, so each phase's shape is still legible
 * and a caller can see which step is dense before paying to expand it.
 */
interface StepsOnlyPlaybook extends Record<string, unknown> {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: Array<{ name: string; description: string; reference_count: number }>;
  gates: string[];
  regulatory_scope_count: number;
  last_updated: string;
}

/** The projection itself, so the handler and the description cannot drift. */
function stepsOnly(p: Playbook): StepsOnlyPlaybook {
  return {
    id: p.id,
    area: p.area,
    ...(p.subarea !== undefined ? { subarea: p.subarea } : {}),
    phases: p.phases.map((ph) => ({
      name: ph.name,
      description: ph.description,
      reference_count: ph.references.length,
    })),
    gates: p.gates,
    regulatory_scope_count: p.regulatory_scope.length,
    last_updated: p.last_updated,
  };
}

export function registerPlaybookTools(server: McpServer): void {
  server.registerTool(
    "search_playbooks",
    {
      title: "Search playbooks",
      description:
        "Ranked, field-scoped search over validation playbooks: area, subarea, phase names, " +
        "and phase descriptions. Returns { results, total_matches, offset, truncated }; " +
        "concise results (default) are { id, area, subarea, phase_count } — pass detail: 'full' " +
        "for complete records. Follow up with expand_playbook (references resolved inline) or " +
        "get_playbook for the raw record.",
      inputSchema: searchInputShape("area, subarea, and phase names/descriptions"),
      outputSchema: searchOutputShape(z.union([ConcisePlaybookHit, PlaybookSchema])),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.playbook.search(query);
      if (detail === "full") return searchResult(paginate(records, limit, offset));
      const concise = records.map((p) => ({
        id: p.id,
        area: p.area,
        ...(p.subarea !== undefined ? { subarea: p.subarea } : {}),
        phase_count: p.phases.length,
      }));
      return searchResult(paginate(concise, limit, offset));
    },
  );

  server.registerTool(
    "get_playbook",
    {
      title: "Get playbook",
      description:
        "Fetch one playbook by ID (area or area/subarea).\n" +
        "  full (default): the whole record — ordered phases, each with a description and a " +
        "references array of mixed regulation://, test://, check:// IDs, plus gates and " +
        "regulatory_scope.\n" +
        "  detail: 'steps': the same phases and gates, with each references array replaced by " +
        "its count and regulatory_scope by its size. Reach for it when the question is what " +
        "the steps ARE — on a dense playbook that is a fifth of the payload and loses nothing " +
        "of the walkthrough.\n" +
        "Unknown ids return isError with a pointer. Use expand_playbook instead when you " +
        "intend to FOLLOW the references, resolved in one call.",
      inputSchema: {
        id: lenient(playbookIdSchema).describe(
          "A playbook id from search_playbooks or get_area_overview — shape playbook://{document}/{slug}",
        ),
        detail: z
          .enum(["full", "steps"])
          .default("full")
          .describe("'steps' drops the reference arrays, keeping their counts"),
      },
      // No outputSchema: the shape varies with `detail`, and an MCP output
      // schema must be an OBJECT schema — a top-level z.union here crashed the
      // SDK on registration ("undefined is not an object (evaluating
      // 's._zod')") and took both modes of this tool down. A union nested
      // inside an object is fine, which is why search_playbooks above keeps
      // one. Same reason expand_playbook, expand_regulation and
      // get_area_overview declare none.
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, detail }) => {
      const record = await adapters.playbook.get(id);
      if (record === null) return miss(`No record for ${id}. Verify the id with search_playbooks or list_review_areas.`);
      return ok(detail === "full" ? record : stepsOnly(record));
    },
  );
}
