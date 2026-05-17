/**
 * URI resource handlers — one per surface scheme.
 *
 * Resources let an MCP client pull content directly via URI without a tool
 * call. The bodies just delegate to the same adapters the tools use.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import { adapters } from "./adapters.ts";
import type {
  CheckId,
  PlaybookId,
  RegulationId,
  TestId,
} from "./schema.ts";

export function registerResources(server: McpServer): void {
  server.registerResource(
    "regulation",
    new ResourceTemplate("regulation://{+path}", { list: undefined }),
    {
      title: "Regulation",
      description:
        "regulation://{framework}/{article}[/{paragraph}[/{point}]] — " +
        "e.g. regulation://crr/178/1/a",
    },
    async (uri, { path }) => {
      const id = `regulation://${String(path)}` as RegulationId;
      const reg = await adapters.regulation.get(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: reg ? JSON.stringify(reg, null, 2) : "",
          },
        ],
      };
    },
  );

  server.registerResource(
    "test",
    new ResourceTemplate("test://{id}", { list: undefined }),
    { title: "Test", description: "test://{test-id}" },
    async (uri, { id }) => {
      const fullId = `test://${String(id)}` as TestId;
      const t = await adapters.test.get(fullId);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: t ? JSON.stringify(t, null, 2) : "" },
        ],
      };
    },
  );

  server.registerResource(
    "check",
    new ResourceTemplate("check://{+path}", { list: undefined }),
    {
      title: "Check",
      description:
        "check://{area}/{topic}[/{specific}] — " +
        "e.g. check://calibration/pd/lra-derived",
    },
    async (uri, { path }) => {
      const fullId = `check://${String(path)}` as CheckId;
      const c = await adapters.check.get(fullId);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: c ? JSON.stringify(c, null, 2) : "" },
        ],
      };
    },
  );

  server.registerResource(
    "playbook",
    new ResourceTemplate("playbook://{+path}", { list: undefined }),
    {
      title: "Playbook",
      description: "playbook://{area}[/{subarea}] — e.g. playbook://calibration/lra",
    },
    async (uri, { path }) => {
      const id = `playbook://${String(path)}` as PlaybookId;
      const p = await adapters.playbook.get(id);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: p ? JSON.stringify(p, null, 2) : "" },
        ],
      };
    },
  );
}
