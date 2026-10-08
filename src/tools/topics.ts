/**
 * `topics`: the areas of the library and the playbook under each.
 *
 * Areas and topics are authored with the playbooks (the `topics` of the library file); a playbook is listed under its topic.
 * Only topics with a playbook appear. A library with no topics file lists the playbooks' own areas.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { firstSentence, READ_ONLY_HINTS, ok } from "./shared.ts";

const slug = (id: string): string => id.replace(/^playbook:\/\//, "");

export function registerTopicsTool(server: McpServer): void {
  server.registerTool(
    "topics",
    {
      title: "Topics",
      description:
        "The areas the library covers and the playbook for each topic: id, title and a one-line scope. Use it to see what exists " +
        "or to pick a playbook by name; for a question, brief finds the playbook itself.",
      inputSchema: {},
      outputSchema: z.object({ areas: z.array(z.object({ id: z.string(), title: z.string(), playbooks: z.array(z.object({ id: z.string(), title: z.string(), scope: z.string() }).passthrough()) }).passthrough()) }).passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async () => {
      const playbooks = await adapters.playbook.list();
      const topics = await adapters.meta.topics?.();
      const byId = new Map(playbooks.map((p) => [slug(p.id), p] as const));
      const areas: Array<{ id: string; title: string; playbooks: Array<{ id: string; title: string; scope: string }> }> = [];
      const placed = new Set<string>();
      for (const a of topics?.areas ?? []) {
        const rows = a.topics.flatMap((t) => {
          const p = byId.get(t.id);
          if (p === undefined) return [];
          placed.add(t.id);
          return [{ id: p.id, title: p.title, scope: firstSentence(t.scope) }];
        });
        if (rows.length > 0) areas.push({ id: a.id, title: a.title, playbooks: rows });
      }
      // Playbooks whose topic the file does not list sit under their own area.
      for (const p of playbooks) {
        if (placed.has(slug(p.id))) continue;
        let area = areas.find((x) => x.id === p.area);
        if (area === undefined) {
          area = { id: p.area, title: p.area, playbooks: [] };
          areas.push(area);
        }
        area.playbooks.push({ id: p.id, title: p.title, scope: firstSentence(p.summary) });
      }
      return ok({ areas });
    },
  );
}
