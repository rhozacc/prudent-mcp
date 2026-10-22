# Prudent: Claude Code plugin

The [prudent-mcp](https://github.com/rhozacc/prudent-mcp) server as a Claude Code plugin: EU regulation and
supervisory practice for internal ratings-based (IRB) credit risk, served read-only through eight tools
(`brief`, `playbook`, `topics`, `search`, `get`, `cite`, `related`, `sources`).

**The server is open source (AGPL-3.0-only). The corpus is not part of it.** The plugin ships no regulatory
content: enable it, and when asked for a *Corpus file* give the path to a corpus JSON file you are licensed
to use. Leave it empty and the server starts with no content, which is enough to see the tools but not to
answer anything.

## What is in this folder

| path | what |
| --- | --- |
| `.claude-plugin/plugin.json` | the manifest |
| `.mcp.json` | starts `node ${CLAUDE_PLUGIN_ROOT}/server/index.mjs` over stdio, with `CORPUS_FILE` from the plugin's setting |
| `server/index.mjs` | the server, bundled into one file with its two MIT dependencies (zod and the MCP SDK); plain Node 18+, no install step |
| `LICENSE`, `THIRD-PARTY-NOTICES.md` | the licence of the server and the notices of what is linked into the bundle |

`server/index.mjs` is generated: `bun run build:plugin` rebuilds it from `src/`, and `bun test` fails when
it is not the build of the current source. Do not edit it by hand.

## Data

The server reads the corpus file you name, locally, and sends nothing anywhere: it has no network code, no
telemetry and no write tools. What a client does with the tool results is up to the client.
