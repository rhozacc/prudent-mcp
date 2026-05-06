#!/usr/bin/env node
/**
 * Prudent-MCP server entry point.
 *
 * Registration is explicit (no decorator side effects) — read this file and
 * you can see exactly what surface area exists.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerMetaTools } from "./tools/meta.ts";
import { registerRegulationTools } from "./tools/regulation.ts";
import { registerTestTools } from "./tools/tests.ts";
import { registerCheckTools } from "./tools/checks.ts";
import { registerPlaybookTools } from "./tools/playbooks.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts/validateReviewArea.ts";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "prudent-mcp",
      version: "0.4.0",
    },
    {
      instructions:
        "IRB credit risk model validation knowledge layer. " +
        "Four surfaces: regulation, tests, checks, playbooks — each with its own URI scheme. " +
        "Read-only. Latest content by default; pass as_of on regulation tools for historical lookups.",
    },
  );

  registerMetaTools(server);
  registerRegulationTools(server);
  registerTestTools(server);
  registerCheckTools(server);
  registerPlaybookTools(server);
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
