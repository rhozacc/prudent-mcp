# prudent-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes a structured knowledge base for IRB credit-risk model validation — regulation, statistical tests, supervisor checks, and validation playbooks — to any LLM client that speaks MCP.

The server is the **read-only knowledge layer**. It tells Claude what the regulation says, what a test measures, what a supervisor expects to see, and how to walk a review area. It does not run statistical tests, write to the corpus, or orchestrate workflows — those concerns live elsewhere.

## Why this exists

Validating an IRB model means cross-referencing a bank's documentation against a moving target: CRR articles, EBA guidelines, ECB guides, supervisor commentary, statistical methodology, and accumulated industry practice. An LLM is well-suited to that cross-referencing if it has structured access to the source material — and badly suited to it if it has to rely on whatever happened to be in its training data.

`prudent-mcp` provides that structured access. It defines four surfaces — regulation, tests, checks, playbooks — each with its own URI scheme, and exposes them through MCP's standard tool/resource/prompt protocol. Any compliant client (Claude Desktop, Claude Code, Cursor, custom integrations) can plug it in.

## Architecture

Two diagrams in [`docs/architecture.md`](./docs/architecture.md): the schema relationships and the request flow. Worth reading before the code.

The four surfaces:

| Surface | URI scheme | Versioning |
|---|---|---|
| Regulation | `regulation://{framework}/{article}[/{paragraph}[/{point}]]` | Per source document — `get_regulation` accepts `as_of` for historical lookups |
| Tests | `test://{test-id}` | Latest only |
| Checks | `check://{area}/{topic}[/{specific}]` | Latest only |
| Playbooks | `playbook://{area}[/{subarea}]` | Latest only |

Plus six cross-cutting tools: `get_corpus_info`, `get_referrers`, `resolve_citation`, `list_review_areas`, `expand_playbook`, `get_area_overview`.

Plus three prompt scaffolds for guided review walkthroughs (`validate_review_area`, `review_calibration`, `assess_findings`).

## Stack

- **Runtime**: [Bun](https://bun.sh) — package manager, test runner, and TypeScript runtime in one binary. No `tsc` step for local dev.
- **MCP**: [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — the official TypeScript SDK.
- **Schemas**: [zod](https://zod.dev) for runtime validation, plus TypeScript template-literal types on URIs so cross-surface ID confusion is a compile error.
- **Schema export**: [`zod-to-json-schema`](https://github.com/StefanTerdell/zod-to-json-schema) to publish JSON Schemas for downstream consumers.

Strict TypeScript throughout — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Don't turn them off.

## Quickstart

```bash
# Install Bun (once)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/<your-org>/prudent-mcp.git
cd prudent-mcp
bun install

# Verify it builds and the in-memory demo runs
bun run typecheck
bun test
bun run inspect:demo
```

The last command opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) in your browser, connected to a server pre-seeded with a small slice of PD-calibration content. Click around — every tool, resource, and prompt is exercisable from there.

## Dev environment setup

This is the path of least resistance. If you already have a TypeScript setup you like, skip what doesn't apply.

### 1. Bun

Bun replaces npm/pnpm/yarn, tsx, and (optionally) vitest. One install:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"

# verify
bun --version    # should print 1.x
```

If you can't install Bun, the project will also work under Node 20+ with `tsx` — but the scripts in `package.json` assume Bun. You'll need to translate them.

### 2. Editor

VSCode / Cursor / any editor with TypeScript LSP. The included `tsconfig.json` is what the LSP reads. Recommended extensions:

- **TypeScript** (built into VSCode)
- **Biome** or **ESLint + Prettier** if you want lint/format. Not currently configured in the repo — add what you prefer.

Type-on-hover and go-to-definition are the day-to-day tools that make the abstraction tractable. If they aren't working, fix that before writing code.

### 3. Install and verify

```bash
bun install
bun run typecheck
bun test
```

`typecheck` should be silent. `bun test` should pass the smoke test.

### 4. Run the demo

```bash
bun run inspect:demo
```

This starts an in-memory server (`examples/inmemory-demo.ts`) seeded with a small slice of content and opens the MCP Inspector against it. Things worth poking at:

| Try | What you'll see |
|---|---|
| `get_corpus_info` | counts and coverage |
| `list_review_areas` | the taxonomy tree |
| `search_regulation` `"long-run average"` | hits CRR 180/1/a and EBA GL para 78 |
| `get_regulation` `"regulation://crr/178/1/b"` | latest text + EBA commentary |
| `get_regulation` with `as_of: "2018-01-01"` | the older 2013-vintage text |
| `get_referrers` `"regulation://crr/180/1/a"` | check://calibration/pd/lra-derived + playbook://calibration/pd |
| `get_playbook` `"playbook://calibration/pd"` | three phases with mixed-surface references |
| `expand_playbook` `"playbook://calibration/pd"` | same, with every reference resolved inline |
| `get_area_overview` `"calibration.pd"` | area node + expanded playbooks + deduplicated ID lists |
| `get_check` `"check://calibration/pd/lra-derived"` | expectation + expected_evidence list |

### 5. Connect a real client

Once the demo is happy, point a real MCP client at it. For Claude Desktop, edit your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"]
    }
  }
}
```

Restart Claude Desktop. The `prudent` server should appear in the tools list. Same shape works for Claude Code, Cursor, and any other MCP-compliant host.

## Project layout

```
prudent-mcp/
├── src/
│   ├── server.ts                MCP server instance + explicit registration
│   ├── schema.ts                zod schemas + template literal URI types
│   ├── adapters.ts              adapter interfaces + empty defaults + handles
│   ├── resources.ts             URI resource handlers
│   ├── tools/                   one file per surface plus meta
│   └── prompts/                 prompt scaffolds
├── examples/
│   ├── inmemory-demo.ts         seeded in-memory server, runnable end-to-end
│   └── README.md
├── scripts/
│   ├── generate-schemas.ts      zod → JSON Schema export
│   └── list-all.ts              print full corpus overview to stdout (bun run list)
├── tests/
│   └── smoke.test.ts            construction smoke test
├── docs/
│   ├── architecture.md          mermaid diagrams: schema + request flow
│   ├── CORPUS.md                corpus structure and per-surface field reference
│   └── schemas/                 generated JSON Schemas (run `bun run schemas`)
└── CLAUDE.md                    brief for Claude Code when extending
```

## Adapters and the corpus

The MCP server reaches its corpus through a small set of adapter interfaces (`src/adapters.ts`). In the open-source distribution the adapters are empty defaults — the server boots, registers all surface area, and answers MCP calls without crashing. Pointing them at a corpus turns the lights on.

The curated **prudent corpus** itself — the regulation, tests, checks, and playbooks records — is a proprietary product, not part of this repository. This repo defines the API and the structure those records take; the corpus that fills it is shipped separately.

`examples/inmemory-demo.ts` is a worked example: a small slice of PD-calibration content seeded into memory, with adapter implementations for every surface. It's runnable as a server end-to-end. Use it as the template when implementing your own backend.

```ts
import { adapters } from "prudent-mcp/adapters";
import { HttpRegulationAdapter } from "./my-corpus.ts";

adapters.regulation = new HttpRegulationAdapter("https://corpus.example.com");
adapters.test = new HttpTestAdapter(/* ... */);
// etc.

import { createServer } from "prudent-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createServer();
await server.connect(new StdioServerTransport());
```

The corpus structure — what records an adapter must serve up — is documented in [`docs/CORPUS.md`](./docs/CORPUS.md). The JSON Schemas under `docs/schemas/` are the machine-readable form, regenerable with:

```bash
bun run schemas
```

Validating records against these as a build step is the cleanest way to keep an adapter in sync with the MCP API.

## Design constraints

These are load-bearing. Don't relax them without discussion:

- **Read-only.** The MCP exposes data; it doesn't accept writes. No `create_finding`, no `update_check`. Mutation belongs upstream of the corpus.
- **No execution.** The MCP describes a Hosmer-Lemeshow test; it doesn't run one. Computation belongs in the host (Claude reading the bank's code) or in dedicated tools — not here.
- **Versioning only on regulation.** Tests, checks, and playbooks track `last_updated` for audit but are always served latest. Only `Regulation` carries multiple versions and accepts `as_of`.
- **URI schemes match surface names.** Resources mirror the same paths the tools speak. Don't introduce a new naming convention partway through.
- **Cross-surface references are typed.** `Check.derived_from: RegulationId[]` is type-enforced. Don't widen to `string[]` for convenience.

## Status

v0.5. Schema, surface area, and adapter shape are stable. The in-memory demo exercises every code path. New since v0.4:

- `Check.expected_evidence` — machine-readable artifact list per check
- Hierarchical check URIs — `check://area/topic/specific` consistent with `regulation://`
- Traversal tools — `expand_playbook` (inline reference resolution) and `get_area_overview` (one-shot review entry point)
- `bun run list` — full corpus overview to stdout

## Ecosystem

`prudent-mcp` is the open-source knowledge layer. It pairs with proprietary components that handle what the MCP boundary deliberately excludes:

- **prudent corpus** — the curated body of regulation, tests, checks, and playbooks that adapters serve up. Proprietary.
- **prudent-runtime** — execution layer for running statistical tests on portfolio data. Where Hosmer-Lemeshow actually gets computed against a model's outputs, not just described. Proprietary.

Both sit outside this repository and are not required to develop against the MCP. The in-memory demo is sufficient for any work on the API itself.

## Contributing

Issues and PRs welcome. A few notes on what fits the design:

- **Schema additions** — new fields are fine if they map to an analyst use case. Open an issue first to talk through the use case.
- **New surfaces** — high bar. The current four cover what the validation workflow actually needs; adding a fifth means rethinking the URI scheme convention. Open a discussion.
- **New cross-cutting tools** — fine if they're pure functions over the corpus. `resolve_citation` and `get_referrers` are the templates.
- **Execution / writes** — out of scope for this repo. These belong in `prudent-runtime` and adjacent components, not here.

For substantial changes, please discuss in an issue before opening a PR.

## License

[AGPL-3.0 license](./LICENSE).
