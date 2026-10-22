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

## For reviewers: what the bundled file does and does not do

A scan of `server/index.mjs` reports a "credential" finding. It is a pattern match, and this is what the file contains:

- **The one environment variable it reads is `CORPUS_FILE`**, a path to a JSON file the user names in the plugin's *Corpus file* setting. It is read with `readFileSync` and parsed. It is not a credential and nothing sends it anywhere.
- **It has no network code.** Its only imports of Node built-ins are `node:process` (stdio) and `node:fs` (`readFileSync`). It has no `http`, `https`, `net`, `tls`, `dgram` or `child_process`, and no `fetch`, `WebSocket` or `XMLHttpRequest`. `tests/plugin.test.ts` fails if that changes.
- **The text `http://[${payload.value}]` in the file** is the bundled zod library's IPv6 string check, which builds a URL object in order to parse an address. Nothing requests it. The server never uses that check.
- **The file is large (about 650 KB) because it bundles its dependencies:** zod and the MCP SDK, both MIT (notices in `THIRD-PARTY-NOTICES.md`), and this repository's own source. It is not minified, and `bun run build:plugin` rebuilds it byte for byte from `src/`.
- **It is launched with `node`**, not through a package manager, and nothing is downloaded at install time.
