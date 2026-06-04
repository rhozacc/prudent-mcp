# Client integrations

`prudent-mcp` speaks the standard [Model Context Protocol](https://modelcontextprotocol.io). Any compliant client can connect to it. This page lists the host configurations that are known to work.

## Claude Desktop — MCPB (no Bun required)

The easiest way to install on Claude Desktop is via the bundled `.mcpb` package. It ships with the Node.js runtime — the user needs no toolchain.

```bash
bun run build:mcpb   # produces dist/prudent-mcp.mcpb
```

Drag `dist/prudent-mcp.mcpb` onto Claude Desktop. An install-time prompt lets you set an optional **Corpus file** path — an absolute path to a corpus JSON file. Leave it empty to start with empty adapters (useful for testing the connection before loading data).

**Corpus file format:**

```json
{
  "regulation": [ ...Regulation objects... ],
  "tests":      [ ...Test objects... ],
  "checks":     [ ...Check objects... ],
  "playbooks":  [ ...Playbook objects... ],
  "taxonomy":   [ ...ReviewArea objects... ]
}
```

All fields are optional; omit any surface and it returns empty results. The JSON is validated against the zod schemas on startup — malformed records are rejected with a clear error rather than silently dropped.

## Claude Desktop — manual config

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"
      ]
    }
  }
}
```

Restart Claude. A green dot next to `prudent` in the lower-left tools indicator confirms the connection. Click it to see the tool list.

If the server fails to load, the developer console (`View → Developer → Open Developer Tools`) shows the stderr stream from the server process.

## Claude Code

In a project directory, create `.mcp.json`:

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"
      ]
    }
  }
}
```

Claude Code picks up `.mcp.json` automatically on session start. Confirm with `/mcp` — the `prudent` server should be listed as connected.

To run against a real corpus instead of the in-memory demo, point `args` at the entrypoint that wires up your adapters.

## Cursor

Cursor uses the same MCP config shape. From the command palette run `Cursor: Open MCP Settings` and add the same `mcpServers` block shown above for Claude Code.

## MCP Inspector

For development and debugging, use the official Inspector. It's the fastest way to exercise every tool, resource, and prompt without touching a real LLM client.

```bash
bun run inspect:demo
```

This boots the in-memory demo server and opens the Inspector at `http://localhost:6274`. The left panel lists tools, resources, and prompts; the right panel runs them and shows raw JSON responses.

Useful flows in the Inspector:

| Action | Tool / target |
|---|---|
| See what's loaded | `get_corpus_info` |
| Browse the taxonomy | `list_review_areas` |
| Try citation resolution | `resolve_citation` with `"Art. 178(1)(a)"` |
| Pull a paragraph | `get_regulation` with `regulation://crr/178/1/a` |
| Walk a playbook | `expand_playbook` with `playbook://calibration/pd` |
| One-shot review entry | `get_area_overview` with `calibration.pd` |

## Programmatic (Node / Bun client)

If you're building tooling that talks to `prudent-mcp` without a human in the loop, use the MCP TypeScript SDK directly:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"],
});

const client = new Client(
  { name: "my-tool", version: "0.1.0" },
  { capabilities: {} },
);

await client.connect(transport);

const overview = await client.callTool({
  name: "get_area_overview",
  arguments: { area: "calibration.pd" },
});

console.log(overview);

await client.close();
```

This is the same JSON-RPC channel the desktop clients use — just driven from a script.

## Streaming HTTP

The current server uses stdio transport (`StdioServerTransport`) and is invoked per-session. If you need shared multi-tenant access over HTTP, wrap `createServer()` in the SDK's HTTP transport instead. The adapter contract doesn't change — only the transport at the edge.

## Troubleshooting

**"Server failed to start"** — check stderr from `bun run examples/inmemory-demo.ts` directly. Most failures are missing dependencies (`bun install`) or a stale Bun version (`bun --version` should be 1.1.x+).

**"No tools showing in the host"** — confirm the host actually read the config file (full restart, not just window reload). For Claude Desktop, the file path is OS-specific; for Claude Code, it must be in the project root or parent.

**"Tools return empty results"** — the default adapters return empty. You're connected, just to an empty corpus. Switch the `args` to point at `examples/inmemory-demo.ts` (which seeds content) or wire up your own adapter.

**"Type errors during local dev"** — `bun run typecheck` should be silent. If it isn't, your Bun-shipped TypeScript is behind. Either pin via `package.json` or pull the latest `bun upgrade`.
