#!/usr/bin/env node
/**
 * Prudent-MCP server entry point.
 *
 * Registration is explicit (no decorator side effects) — read this file and
 * you can see exactly what surface area exists.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import packageJson from "../package.json";
import { registerBriefTool } from "./tools/brief.ts";
import { registerCiteTool } from "./tools/cite.ts";
import { registerGetTool } from "./tools/get.ts";
import { registerPlaybookTool } from "./tools/playbook.ts";
import { registerRelatedTool } from "./tools/related.ts";
import { registerSearchTool } from "./tools/search.ts";
import { registerSourcesTool } from "./tools/sources.ts";
import { registerTopicsTool } from "./tools/topics.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts/walkThrough.ts";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "prudent-mcp",
      // Single-sourced from package.json — the two drifted before.
      version: packageJson.version,
    },
    {
      // Written in the library's own words (src/language.ts, eval I17): a model repeats what it is told to the person it is
      // answering. Tool names are the one exception, since they have to be named. The rules about the EDGE of the library
      // (amended text, versions, an instrument not held, a placeholder, a weak match) are not here: each response carries
      // the note that applies, at the point it applies, written to be repeated as it stands. About 300 tokens, held there
      // by tests/instructions.test.ts.
      instructions:
        "Prudent: EU regulation and supervisory practice for internal ratings-based (IRB) credit risk (the CRR, EBA guidelines and the " +
        "ECB guide to internal models), with a playbook per topic.\n" +
        "For any substantive question, call brief first: it returns the playbook that answers it and the provisions that matter. " +
        "Expand with playbook; open specific provisions with search, get or cite; use related for neighbouring provisions and " +
        "sources for what the library covers and what is changing.\n" +
        "When you answer: cite provisions by their official citation (e.g. \"EBA/GL/2017/16 para 28\", \"Art. 179(1)(d) CRR\"), never by " +
        "internal identifiers, and do not describe the tools. Keep law, EBA guidelines, ECB supervisory expectations and market practice " +
        "distinct, as the playbook labels them. Repeat each note a response carries: when a provision is amended or about to be, say so " +
        "with the date and what changes. When the question turns on an instrument the library does not hold, name it and answer from " +
        "general knowledge, marked as such.",
    },
  );

  registerBriefTool(server);
  registerPlaybookTool(server);
  registerTopicsTool(server);
  registerSearchTool(server);
  registerGetTool(server);
  registerCiteTool(server);
  registerRelatedTool(server);
  registerSourcesTool(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

export const server = createServer();

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if invoked directly (not when imported by examples or tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("prudent-mcp failed to start:", err);
    process.exit(1);
  });
}
