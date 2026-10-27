# Quickstart

```bash
curl -fsSL https://bun.sh/install | bash   # Bun 1.1 or later, once

git clone https://github.com/rhozacc/prudent-mcp.git
cd prudent-mcp
bun install
bun run test:ci        # typecheck, tests, corpus linter, context evals
bun run inspect:demo   # MCP Inspector on the seeded demo
```

`bun run inspect:demo` opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) on an in-memory server (`examples/inmemory-demo.ts`) seeded with a small synthetic slice of PD-calibration content: one compiled playbook, a handful of CRR and EBA provisions, three tests, four checks and a source registry with one pending amendment. The demo is the only data in this repository; the curated corpus is a separate proprietary product.

## Things worth trying

| Call | What you see |
|---|---|
| `topics` | the one area and its playbook |
| `brief` `"How is the long-run average PD derived?"` | the playbook, rendered as text: what it rests on, what has to be shown, methods, pitfalls |
| `playbook` `pd-long-run-average` with `section: "R2"` | one requirement with the full text of its provisions |
| `search` `"long-run average"` | Art. 180(1)(a) CRR and EBA/GL/2017/16 para 78, with coverage |
| `get` `regulation://crr/178/1/a` | the provision with a `notes` entry: a recorded amendment applying in 60 days, with the new wording |
| `get` `regulation://crr/178/1/b` with `as_of: "2018-01-01"` | the 2013-vintage text; `document_version` differs |
| `get` `regulation://crr/178/1/a` with `as_of: "2020-01-01"` | the current text and a `version` note saying it is not that date's text |
| `cite` `"Art. 180(1)(a) CRR"` | the provision, `confidence: "exact"` |
| `cite` `"Article 5 of Regulation (EU) 2019/2033"` | `match: null` and an `outside_library` note |
| `related` `regulation://crr/180/1/a` | its check, its tests and the playbook requirement that rests on it |
| `sources` | each document, held whole, in part or undeclared, and the open changes |

The same calls from a shell, without a client: `bun run evals:call search '{"query":"long-run average"}'`. `bun run list` prints the demo's contents.

## Connect a client

See [Clients](/guide/clients) for Claude Desktop, Claude Code, Cursor and programmatic use, and for pointing the server at a corpus file.

## Working on the code

`bun run test:ci` is the gate and what CI runs. The pieces, in the order to read them: `src/schema.ts` (the shapes), `src/tools/` (one file per tool), `src/search.ts` (ranking), `src/citation/` (citation resolution), `src/file-adapter.ts` (loading a corpus file), `evals/` (the context-quality invariants). [Architecture](/guide/architecture) is the map.
