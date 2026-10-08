/**
 * `sources`: what the library holds, document by document, and what is changing.
 *
 * Without an id: every document (title, status, whether it is held whole, in part or undeclared, how many provisions, when it
 * was last confirmed current, the next dated milestone), the changes recorded for them that the text does not yet include,
 * and which documents are overdue for a currency check. With an id (a source id, or a document id): the whole entry with each
 * recorded change and where it stands today.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { isoDay, pendingState } from "../pending.ts";
import { PendingChangeSchema, PendingChangeStateSchema, SourceSchema } from "../schema.ts";
import type { DocumentHolding, Source } from "../schema.ts";
import { READ_ONLY_HINTS, miss, ok, stripEdgeNoise } from "./shared.ts";

const ServedChange = PendingChangeSchema.extend({ state: PendingChangeStateSchema }).passthrough();

const heldOf = (h: DocumentHolding | undefined): "whole" | "part" | "undeclared" => (h === undefined || h.partial === undefined ? "undeclared" : h.partial ? "part" : "whole");

export function registerSourcesTool(server: McpServer): void {
  server.registerTool(
    "sources",
    {
      title: "Sources",
      description:
        "What the library holds and how current it is. Without id: each document with its status, whether it is held whole, in part or " +
        "undeclared (not finding a provision of a part-held document is not evidence it does not exist), provisions held, when it was last " +
        "confirmed current and its next dated milestone; changes recorded for a document that its text does not yet include; documents " +
        "overdue for a currency check. With id (a source id or a document id): the full entry with each change and its state today. " +
        "Call this to say what the library covers; it never means the law is covered.",
      inputSchema: { id: z.string().optional().describe("A source id or a document id, as listed without id.") },
      // Two shapes (the list, one entry); open, with the list's keys named so a client can read them off the schema.
      outputSchema: z
        .object({
          documents: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
          counts: z.record(z.number()).optional(),
          changes: z.array(z.object({ title: z.string(), state: z.string() }).passthrough()).optional(),
          overdue_for_check: z.array(z.string()).optional(),
        })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id: raw }) => {
      const today = isoDay(new Date());
      const sources = await adapters.source.list();
      if (raw !== undefined) {
        const id = stripEdgeNoise(raw);
        const hit: Source | undefined = sources.find((s) => s.id === id) ?? sources.find((s) => s.document_id === id && s.status === "current") ?? sources.find((s) => s.document_id === id);
        if (hit === undefined) return miss(`This library has no source with the id ${raw}. Call sources without an id to list them.`);
        const info = await adapters.meta.info();
        const holding = info.holdings?.find((h) => h.document_id === hit.document_id && h.framework === hit.framework);
        return ok({
          ...hit,
          held: heldOf(holding),
          ...(holding === undefined ? {} : { provisions: holding.records }),
          ...(hit.pending_changes === undefined ? {} : { pending_changes: hit.pending_changes.map((c) => ({ ...c, state: pendingState(c, today) })) }),
        });
      }
      const info = await adapters.meta.info();
      const documents = sources.map((s) => {
        const holding = info.holdings?.find((h) => h.document_id === s.document_id && h.framework === s.framework);
        const open = (s.pending_changes ?? []).filter((c) => pendingState(c, today) !== "ingested").length;
        return {
          id: s.id,
          title: s.title,
          document_id: s.document_id,
          framework: s.framework,
          status: s.status,
          held: heldOf(holding),
          ...(holding === undefined ? {} : { provisions: holding.records }),
          verified: s.verified,
          ...(s.effective_from === undefined ? {} : { effective_from: s.effective_from }),
          ...(s.superseded_by === undefined ? {} : { superseded_by: s.superseded_by }),
          ...(s.milestones[0] === undefined ? {} : { next_milestone: s.milestones[0] }),
          ...(open === 0 ? {} : { open_changes: open }),
        };
      });
      return ok({
        documents,
        counts: info.counts,
        ...(info.pending_changes === undefined ? {} : { changes: info.pending_changes }),
        ...(info.stale_sources.length === 0 ? {} : { overdue_for_check: info.stale_sources }),
      });
    },
  );
}

export { SourceSchema, ServedChange };
