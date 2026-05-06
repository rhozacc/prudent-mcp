# Claude Code: prudent-mcp v0.4

This file is the working brief when extending the codebase. For human onboarding read `README.md` and `docs/CORPUS.md` first.

## What this is

An MCP server that exposes a structured knowledge base for IRB credit-risk model validation. Four parallel surfaces — `regulation`, `tests`, `checks`, `playbooks` — each with its own URI scheme, plus cross-cutting tools, a review-area taxonomy, and prompt scaffolds.

The server is the **read-only knowledge layer**. No execution, no writes, no orchestration. That boundary is load-bearing.

## What's already here

```
src/
├── server.ts              MCP server + explicit registration of every module
├── schema.ts              zod schemas + template literal URI types
├── adapters.ts            interfaces per surface + empty defaults + handles
├── resources.ts           URI templates mirroring the schemes
├── tools/                 meta + one file per surface
└── prompts/               three prompt scaffolds

examples/inmemory-demo.ts  seeded in-memory server, runnable end-to-end
scripts/generate-schemas.ts  zod → JSON Schema export
docs/                      architecture, corpus structure, generated schemas
tests/smoke.test.ts        construction smoke test
```

Every tool, resource, and prompt has a description, a zod input schema, and a handler. In the open-source distribution the default adapters return empty results. The in-memory demo reassigns adapter handles to seed real content for development and inspection.

## Stack

Bun. TypeScript strict. `@modelcontextprotocol/sdk` (TS-first). zod for runtime validation, template literal types (`type RegulationId = `regulation://${string}``) for compile-time URI segregation.

`bun run typecheck`, `bun test`, `bun run inspect:demo`, `bun run schemas`. No `tsc` build step for local dev.

## What to do when extending

1. Read `src/schema.ts` and `docs/CORPUS.md` together — schema decisions all map to a use case.
2. `bun install && bun run typecheck && bun test`.
3. `bun run inspect:demo` — exercise the surface end-to-end.
4. Make your change. Strict mode catches things; trust the type errors.
5. If you change schemas, run `bun run schemas` and commit the regenerated JSON Schemas under `docs/schemas/`.

## Schema decisions worth understanding before extending

- **Template literal URI types** — `Check.derived_from: RegulationId[]` rejects a `TestId` at compile time. Don't widen to `string[]`.
- `Check.derived_from` + `Check.expectation` — traceability from supervisor expectations back to law. Without this, a Check is opinion.
- `Test.family` + `Test.aliases` + `Test.acceptance_criteria` — equivalence reasoning across bank-specific test variants.
- `Regulation.commentary` — interpretive material (Q&A, supervisor letters), source-attributed.
- `Playbook.phases` — structured walkthrough with mixed-surface references in each phase.
- `ReviewArea` — canonical taxonomy. The map from "what an analyst is doing" to "what's in the corpus."

## Design constraints

- Read-only. No write tools.
- No execution. The server describes; computation lives elsewhere.
- Versioning only on `Regulation`. Other surfaces always serve latest.
- URI schemes match surface names.
- Cross-surface references are typed.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Keep both on.

## Don't add (yet)

- Excerpt rendering on `search_*` results.
- Authentication, rate limiting, telemetry.
- More reference adapters under `examples/`. The in-memory demo is the template; backend-specific adapters belong outside this repo.
- More prompts beyond the existing three scaffolds.

## Surface area target

```
Tools:       12   4 cross-cutting + (search + get) × 4 surfaces
Templates:    4   one per URI scheme
Prompts:      3   validate_review_area · review_calibration · assess_findings
Schemas:      9   Regulation · Test · Check · Playbook · CorpusInfo · Referrers
                  · Commentary · Phase · ReviewArea
```
