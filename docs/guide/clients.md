# Clients

`prudent-mcp` speaks the standard [Model Context Protocol](https://modelcontextprotocol.io) over stdio. Any compliant client can connect. Without a corpus file the server starts empty; the demo (`examples/inmemory-demo.ts`) seeds a small synthetic slice for trying it.

## Claude Desktop: the `.mcpb` bundle

Download the `.mcpb` from the [latest release](https://github.com/rhozacc/prudent-mcp/releases/latest) and open it, or build it yourself:

```bash
bun run build:mcpb   # bundles src/mcpb-entry.ts and packs dist/mcpb into a .mcpb
```

It carries its own Node runtime, so the user needs no toolchain. An install-time prompt sets the optional **Corpus file**: an absolute path to a corpus JSON file. Leave it empty to start with no content.

### Corpus file format

```json
{
  "regulation":         [ ...Regulation... ],
  "tests":              [ ...Test... ],
  "checks":             [ ...Check... ],
  "playbooks":          [ ...Playbook (compiled)... ],
  "sources":            [ ...Source... ],
  "regulation_history": [ { "id": "...", "effective_from": "...", "record": { ...Regulation... } } ],
  "topics":             { "version": 1, "areas": [ ... ] },
  "glossary":           { "abbreviation": ["phrase the texts use"] }
}
```

Every key is optional; an omitted surface is empty. The file is validated against the zod schemas on load: a malformed record is rejected with an error, never silently dropped. The `.mcpb` entry also runs the structural linter at startup: integrity violations abort, staleness warnings print to stderr. See [Corpus structure](/corpus/).

## Claude Code

As a one-line server:

```bash
claude mcp add prudent --env CORPUS_FILE=/abs/path/corpus.json -- bun run /abs/path/prudent-mcp/src/mcpb-entry.ts
```

As a plugin: the folder `plugin/` of this repository carries the server as one bundled file run with `node`, so it needs no Bun. Enable it and give the optional *Corpus file* when asked.

A clone also carries a `.mcp.json` that starts the demo, so `bun install` and starting Claude Code in the clone is enough. Confirm with `/mcp`.

## Claude Desktop and Cursor: manual config

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/prudent-mcp/src/mcpb-entry.ts"],
      "env": { "CORPUS_FILE": "/absolute/path/to/corpus.json" }
    }
  }
}
```

Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows); Cursor takes the same block from *Cursor: Open MCP Settings*. Use `examples/inmemory-demo.ts` as the argument to try the seeded demo. Restart the client after editing.

## MCP Inspector

```bash
bun run inspect:demo
```

Boots the demo and opens the Inspector at `http://localhost:6274`: tools, resources and the prompt on the left, raw JSON replies on the right. A good first pass: `topics`, `brief`, then `get` and `cite` on what comes back ([Examples](/examples/)).

## Programmatic client

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "my-tool", version: "0.1.0" }, { capabilities: {} });
await client.connect(
  new StdioClientTransport({ command: "bun", args: ["run", "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"] }),
);

const answer = await client.callTool({
  name: "brief",
  arguments: { question: "How is the long-run average PD derived?" },
});
console.log(answer.structuredContent); // { text, playbook, notes?, ... }

await client.close();
```

## Over HTTP

The server ships a stdio transport only. To serve it over HTTP, wrap `createServer()` in the SDK's HTTP transport; the adapter contract does not change. A modified version offered over a network must offer its source (AGPL-3.0 §13); see the licence note in the README.

## Troubleshooting

- **Server failed to start**: run the command by hand and read stderr. Usually `bun install` was not run, or Bun is older than 1.1 (`bun --version`).
- **No tools in the host**: restart the host fully, not just the window. Claude Code reads `.mcp.json` from the project root or a parent.
- **Tools return nothing**: you are connected to an empty library. Set `CORPUS_FILE` or run the demo.
- **Corpus refused at startup**: the linter names the record and the rule. `bun run validate` shows the same report for the demo or for `CORPUS_FILE`.
