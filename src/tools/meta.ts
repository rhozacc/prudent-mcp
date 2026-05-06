/**
 * Cross-cutting tools — operate across all four surfaces.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";

function asJson(value: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "get_corpus_info",
    {
      description:
        "What's loaded right now. Tells Claude what's actually queryable. " +
        "Returns { last_updated, counts: {regulation, test, check, playbook}, coverage: [...] }.",
      inputSchema: {},
    },
    async () => asJson(await adapters.meta.info()),
  );

  server.registerTool(
    "get_referrers",
    {
      description:
        "Find everything that references this ID. Works on any surface. " +
        "Returns { regulation: [...], tests: [...], checks: [...], playbooks: [...] }.",
      inputSchema: {
        id: z.string().describe("Any surface ID — regulation://, test://, check://, or playbook://."),
      },
    },
    async ({ id }) => asJson(await adapters.meta.referrers(id)),
  );

  server.registerTool(
    "resolve_citation",
    {
      description:
        "Loose citation string → structured Regulation.\n" +
        '"Art. 178(1)(a)"            → regulation://crr/178/1/a\n' +
        '"CRR Article 178"           → regulation://crr/178\n' +
        '"EBA GL on PD-LGD, para 83" → regulation://eba/gl-2017-16/83',
      inputSchema: {
        text: z.string().describe("A loose, human-prose citation."),
      },
    },
    async ({ text }) => asJson(await adapters.meta.resolveCitation(text)),
  );

  server.registerTool(
    "list_review_areas",
    {
      description:
        "The canonical taxonomy of review areas. Use this to map a real-world task " +
        "('I'm reviewing LGD calibration') onto the corpus's structure. Without this, " +
        "every review invents its own mapping from doc sections to corpus content.",
      inputSchema: {},
    },
    async () => asJson(await adapters.meta.taxonomy()),
  );
}
