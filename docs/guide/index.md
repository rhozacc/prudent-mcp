# Introduction

`prudent-mcp` is an [MCP](https://modelcontextprotocol.io) server that exposes a structured knowledge base for IRB credit-risk model validation — regulation, statistical tests, supervisor checks, and validation playbooks — to any LLM client that speaks MCP.

The server is the **read-only knowledge layer**. It tells Claude what the regulation says, what a test measures, what a supervisor expects to see, and how to walk a review area. It does not run statistical tests, write to the corpus, or orchestrate workflows.

## Why this exists

Validating an IRB model means cross-referencing a bank's documentation against a moving target: CRR articles, EBA guidelines, ECB guides, supervisor commentary, statistical methodology, and accumulated industry practice. An LLM is well-suited to that cross-referencing if it has structured access to the source material — and badly suited to it if it has to rely on whatever happened to be in its training data.

`prudent-mcp` provides that structured access. It defines four surfaces — regulation, tests, checks, playbooks — each with its own URI scheme, and exposes them through MCP's standard tool/resource/prompt protocol. Any compliant client (Claude Desktop, Claude Code, Cursor, custom integrations) can plug it in.

## The four surfaces

| Surface | URI scheme | What it represents |
|---|---|---|
| **Regulation** | `regulation://{framework}/{article}[/{paragraph}[/{point}]]` | Versioned per source document. `get_regulation` accepts `as_of` for historical lookups. |
| **Tests** | `test://{test-id}` | Statistical tests described — what they measure, when to use them, how to read their output. Never executed. |
| **Checks** | `check://{area}/{topic}[/{specific}]` | Qualitative checks with a concrete pass/fail expectation, traced back to law via `derived_from: RegulationId[]`. |
| **Playbooks** | `playbook://{area}[/{subarea}]` | Guided walkthroughs structured as ordered phases with mixed-surface references. |

Plus six cross-cutting tools: `get_corpus_info`, `get_referrers`, `resolve_citation`, `list_review_areas`, `expand_playbook`, `get_area_overview`.

Plus three prompt scaffolds for guided review walkthroughs.

## Design constraints

These are load-bearing — don't relax them without discussion:

- **Read-only.** No `create_finding`, no `update_check`. Mutation belongs upstream of the corpus.
- **No execution.** The MCP describes a Hosmer-Lemeshow test; it doesn't run one.
- **Versioning only on regulation.** Tests, checks, and playbooks track `last_updated` for audit but are always served latest.
- **URI schemes match surface names.** Don't introduce a new naming convention partway through.
- **Cross-surface references are typed.** `Check.derived_from: RegulationId[]` is type-enforced at compile time.

## Ecosystem

`prudent-mcp` is the open-source knowledge layer. It pairs with proprietary components that handle what the MCP boundary deliberately excludes:

- **prudent corpus** — the curated body of regulation, tests, checks, and playbooks that adapters serve up.
- **prudent-runtime** — execution layer for running statistical tests on portfolio data.

Both sit outside this repository. The in-memory demo is sufficient for any work on the API itself.
