/**
 * Sources surface — the registry of source documents the corpus derives from,
 * with currency status. Read-only like everything else: maintaining the
 * registry means editing the corpus file (see .claude/commands/maintain-context.md),
 * never calling tools.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { MilestoneSchema, SourceSchema, SourceStatusSchema, sourceIdSchema } from "../schema.ts";
import type { Milestone, Source, SourceId, SourceStatus } from "../schema.ts";
import { READ_ONLY_HINTS, lenient, miss, ok } from "./shared.ts";

// list_sources projection. Members are explicit `| undefined` unions (not
// optional markers) so direct assignment compiles under
// exactOptionalPropertyTypes; JSON.stringify drops undefined-valued keys.
type SourceSummary = {
  id: SourceId;
  title: string;
  doc_type: Source["doc_type"];
  status: SourceStatus;
  verified: string;
  effective_from: string | undefined;
  superseded_by: SourceId | undefined;
  next_milestone: Milestone | undefined;
};

const SourceSummarySchema = z.object({
  id: sourceIdSchema,
  title: z.string(),
  doc_type: SourceSchema.shape.doc_type,
  status: SourceStatusSchema,
  verified: z.string().describe("Last date currency was confirmed against the publisher"),
  effective_from: z.string().optional(),
  superseded_by: sourceIdSchema.optional(),
  next_milestone: MilestoneSchema.optional().describe("First upcoming regulatory date"),
});

export function registerSourceTools(server: McpServer): void {
  server.registerTool(
    "list_sources",
    {
      title: "List sources",
      description:
        "The registry of source documents the corpus derives from — the " +
        "'is my regulatory context current?' answer. Returns { sources: [...] } with, per " +
        "source: id, title, doc_type, status (current | pending | superseded), verified " +
        "(last date currency was confirmed against the publisher), effective_from, " +
        "superseded_by, and next_milestone (the first upcoming regulatory date; milestones " +
        "are kept chronological). Optionally filter by status. Call get_source for the full " +
        "record including all milestones, or search_regulation for corpus content under a " +
        "document (sources join regulation records via framework + document_id).",
      inputSchema: {
        status: SourceStatusSchema.optional().describe("Filter by lifecycle status."),
      },
      outputSchema: z.object({ sources: z.array(SourceSummarySchema) }).passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ status }) => {
      const sources = await adapters.source.list(status === undefined ? undefined : { status });
      return ok({
        sources: sources.map(
          (s): SourceSummary => ({
            id: s.id,
            title: s.title,
            doc_type: s.doc_type,
            status: s.status,
            verified: s.verified,
            effective_from: s.effective_from,
            superseded_by: s.superseded_by,
            next_milestone: s.milestones[0],
          }),
        ),
      });
    },
  );

  server.registerTool(
    "get_source",
    {
      title: "Get source",
      description:
        "Fetch one source document record by ID. Returns the full record: title, framework, " +
        "document_id (joins to Regulation.document_id), doc_type, status, published / " +
        "effective_from / verified dates, superseded_by (set when status is superseded), " +
        "milestones (upcoming regulatory dates, chronological), url, and notes. Unknown ids " +
        "return isError with a pointer. Use list_sources to see the whole registry, or " +
        "search_regulation for the corpus content derived from this document.",
      inputSchema: {
        id: lenient(sourceIdSchema).describe(
          "A source id from list_sources — shape source://{framework}/{document-id}",
        ),
      },
      outputSchema: SourceSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id }) => {
      const record = await adapters.source.get(id);
      if (record === null) return miss(`No record for ${id}. Verify the id with list_sources.`);
      return ok(record);
    },
  );
}
