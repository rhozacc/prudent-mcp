/**
 * URI resource handlers — one per surface scheme.
 *
 * Resources let an MCP client pull content directly via URI without a tool
 * call. The bodies just delegate to the same adapters the tools use. Misses
 * surface as JSON-RPC errors (the MCP resource-not-found code, -32002) rather
 * than empty-bodied 200s, and each template offers completion over the ids the
 * connected adapters actually hold.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CompleteResourceTemplateCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { adapters } from "./adapters.ts";
import { renderPlaybook } from "./render.ts";
import { servedPlaybookContext } from "./tools/playbook-context.ts";
import type {
  CheckId,
  PlaybookId,
  RegulationId,
  SourceId,
  TestId,
} from "./schema.ts";

// MCP's resource-not-found JSON-RPC error code (not in the SDK's ErrorCode enum).
const RESOURCE_NOT_FOUND = -32002;

function notFound(uri: string, verifyWith: string): never {
  throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${uri}. Verify the id with ${verifyWith}.`, { uri });
}

/**
 * Completion over the ids a surface adapter holds: strips the scheme prefix
 * (completion fills the template variable, not the whole URI), filters by what
 * the user has typed so far, and suggests at most 50.
 */
function completeIds(load: () => Promise<string[]>, prefix: string): CompleteResourceTemplateCallback {
  return async (value) => {
    const ids = await load();
    return ids
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length))
      .filter((path) => path.startsWith(value))
      .slice(0, 50);
  };
}

function asJsonContents(uri: string, record: unknown) {
  return {
    contents: [
      { uri, mimeType: "application/json", text: JSON.stringify(record, null, 2) },
    ],
  };
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "regulation",
    new ResourceTemplate("regulation://{+path}", {
      list: undefined,
      complete: {
        path: completeIds(async () => (await adapters.regulation.list()).map((r) => r.id), "regulation://"),
      },
    }),
    {
      title: "Regulation",
      description:
        "regulation://{framework}/{article}[/{paragraph}[/{point}]] — " +
        "regulation://{document}/{provision} — ids come from search",
    },
    async (uri, { path }) => {
      const id = `regulation://${String(path)}` as RegulationId;
      const reg = await adapters.regulation.get(id);
      if (reg === null) notFound(uri.href, "search");
      return asJsonContents(uri.href, reg);
    },
  );

  server.registerResource(
    "test",
    // {+path}, not {id}: a simple RFC 6570 variable cannot match a "/", and
    // every test id the corpus mints is two-segment
    // (test://gl-2019-03/downturn-lgd-vs-reference-value). With {id} this
    // surface could not resolve a single real record — resources/read fell
    // through to "no such resource" (-32602) rather than reaching the adapter
    // at all. The other four surfaces already use {+path}; this was the one
    // that did not, and the in-memory demo hid it by seeding SINGLE-segment
    // test ids (test://jeffreys), which {id} matches perfectly.
    new ResourceTemplate("test://{+path}", {
      list: undefined,
      complete: {
        path: completeIds(async () => (await adapters.test.list()).map((t) => t.id), "test://"),
      },
    }),
    {
      title: "Test",
      description: "test://{document}/{slug} — ids come from search",
    },
    async (uri, { path }) => {
      const fullId = `test://${String(path)}` as TestId;
      const t = await adapters.test.get(fullId);
      if (t === null) notFound(uri.href, "search");
      return asJsonContents(uri.href, t);
    },
  );

  server.registerResource(
    "check",
    new ResourceTemplate("check://{+path}", {
      list: undefined,
      complete: {
        path: completeIds(async () => (await adapters.check.list()).map((c) => c.id), "check://"),
      },
    }),
    {
      title: "Check",
      description:
        "check://{area}/{topic}[/{specific}] — " +
        "check://{document}/{slug} — ids come from search",
    },
    async (uri, { path }) => {
      const fullId = `check://${String(path)}` as CheckId;
      const c = await adapters.check.get(fullId);
      if (c === null) notFound(uri.href, "search");
      return asJsonContents(uri.href, c);
    },
  );

  server.registerResource(
    "playbook",
    new ResourceTemplate("playbook://{+path}", {
      list: undefined,
      complete: {
        path: completeIds(async () => (await adapters.playbook.list()).map((p) => p.id), "playbook://"),
      },
    }),
    {
      title: "Playbook",
      description: "playbook://{topic} — ids come from topics and brief",
    },
    async (uri, { path }) => {
      const id = `playbook://${String(path)}` as PlaybookId;
      const p = await adapters.playbook.get(id);
      if (p === null) notFound(uri.href, "topics");
      const rendered = renderPlaybook(p, await servedPlaybookContext());
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: rendered?.text ?? "" }] };
    },
  );

  server.registerResource(
    "source",
    new ResourceTemplate("source://{+path}", {
      list: undefined,
      complete: {
        path: completeIds(async () => (await adapters.source.list()).map((s) => s.id), "source://"),
      },
    }),
    {
      title: "Source",
      description:
        "source://{framework}/{document-id} — ids come from sources",
    },
    async (uri, { path }) => {
      const id = `source://${String(path)}` as SourceId;
      const s = await adapters.source.get(id);
      if (s === null) notFound(uri.href, "sources");
      return asJsonContents(uri.href, s);
    },
  );
}
