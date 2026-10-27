---
title: prudent-mcp
titleTemplate: Structured regulatory knowledge for IRB credit risk
sidebar: false
aside: false
---

<p class="eyebrow">MCP server · read-only knowledge layer</p>

# prudent-mcp

<p class="page-sub">
prudent-mcp serves a structured, typed knowledge base for IRB credit-risk
regulation over the Model Context Protocol: regulation, statistical tests,
supervisor checks, compiled per-topic playbooks, and a registry of the source
documents the corpus derives from. Analyst, validator, supervisor, auditor or
developer — the surface is the same. It is read-only by construction: the server describes;
nothing executes and nothing mutates.
</p>

## The five surfaces

| | Surface | URI scheme | An entry asserts |
|---|---|---|---|
| <span class="dot regulation"></span> | **Regulation** | `regulation://{framework}/{article}…` | What the law says — versioned, `as_of`-queryable |
| <span class="dot test"></span> | **Tests** | `test://[{family}/]{test-id}` | What a statistical test measures and when to trust it — described, never executed |
| <span class="dot check"></span> | **Checks** | `check://{area}/{topic}…` | What a supervisor expects to see, traced to law via `derived_from` |
| <span class="dot playbook"></span> | **Playbooks** | `playbook://{topic}` | What one topic requires, compiled across documents, every requirement cited |
| <span class="dot commentary"></span> | **Sources** | `source://{framework}/{doc-id}` | Whether the regulatory context is current — verification dates, supersession, milestones |

Eight tools sit on top. `brief` routes a question to the playbook that answers it; `playbook` and `topics` expand and list playbooks; `search`, `get` and `cite` open provisions; `related` walks to their neighbours; `sources` says what the library covers and what is changing. See the [tool reference](/tools/) and a [worked session](/examples/).

## Download

**Claude Desktop** — download the packaged `.mcpb` bundle from the
[latest release](https://github.com/rhozacc/prudent-mcp/releases/latest) and open
it. Claude Desktop installs it as an extension; an install-time prompt sets the
optional corpus file path. No toolchain required.

**Claude Code** — one line:

```bash
claude mcp add prudent --env CORPUS_FILE=/abs/path/corpus.json -- bun run /abs/path/prudent-mcp/src/mcpb-entry.ts
```

**From source** — clone, install, and inspect the seeded demo corpus:

```bash
git clone https://github.com/rhozacc/prudent-mcp && cd prudent-mcp
bun install
bun run inspect:demo
```

Other hosts and manual JSON config: [Client integrations](/guide/clients).

## Where to go next

| Section | What's there |
|---|---|
| [Quickstart](/guide/quickstart) | Install, run the demo, first calls |
| [Clients](/guide/clients) | Claude Desktop, Claude Code, Cursor, programmatic use, the corpus file |
| [Architecture](/guide/architecture) | Surfaces, request lifecycle, boundaries |
| [Tools](/tools/) | All eight tools, notes, resources, the prompt — inputs, replies, migration from 0.x |
| [Corpus structure](/corpus/) | URI schemes, record shapes, versioning, cross-reference rules |
| [Schema reference](/corpus/schemas) | Generated field-level reference for every schema |
| [Corpus graph](/corpus/graph) | How the surfaces reference each other |
| [Examples](/examples/) | brief, playbook, get and cite against the demo corpus |

The open-source server ships with empty adapters and a seeded in-memory demo — the
schemas, tools, and corpus linter are all here under
[AGPL-3.0-only](https://github.com/rhozacc/prudent-mcp/blob/main/LICENSE), with a
commercial licence available for embedding, OEM and on-prem. A corpus is
what you bring: point `CORPUS_FILE` at your own, or write adapters against any
backend. The corpus is data the server reads, not part of the program — your own
stays yours. Every corpus is linted on startup, so broken cross-references,
supersession cycles, and stale sources refuse to serve.
