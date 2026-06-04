# Changes

## Regulation children: checks and tests

`Regulation.children` widened from `RegulationId[]` to `RegulationChildId[]` (`RegulationId | TestId | CheckId`). A regulation record can now attach the checks and tests that operationalize it, alongside its sub-regulations — still typed, so a `PlaybookId` is rejected at compile time.

- `src/schema.ts` — new `RegulationChildId` type + `regulationChildIdSchema`; `Regulation.children` uses it. Added `parent?: RegulationId` to `Check` and `Test` (the inverse of `children`).
- **Mirror invariant** — a check/test listed in `Regulation.children` must also name that regulation in its `derived_from` / `regulatory_basis`, and point back via `parent`. Keeps `derived_from` / `regulatory_basis` the single authoritative up-link, so `get_referrers` is unchanged.
- `examples/inmemory-demo.ts` — seeded the relationship: `crr/180/1/a` attaches `check://calibration/pd/lra-derived`; `crr/180` mixes a sub-paragraph with `check://calibration/pd/segment-tested`; `eba/gl-2017-16/78` attaches the three calibration tests. Each carries the mirroring `parent`.
- `scripts/list-all.ts` — prints regulation `children` and check/test `parent`.
- `docs/schemas/{Regulation,Check,Test}.schema.json` — regenerated via `bun run schemas`.
- Docs — `docs/corpus/index.md`, `docs/tools/regulation.md`, `docs/guide/architecture.md`, `README.md`, `CLAUDE.md`.
- `tests/smoke.test.ts` — added coverage for checks/tests as children plus the mirror invariant.

## MCPB distribution

Added zero-dependency distribution as a `.mcpb` bundle for Claude Desktop.

- `src/file-adapter.ts` — in-memory adapters loaded from a corpus JSON file. All five surfaces (regulation, test, check, playbook, meta) backed by maps parsed from the file. Zod-validated at load time; malformed records error on startup rather than at query time.
- `src/mcpb-entry.ts` — MCPB entry point. Reads `CORPUS_FILE` env var; if set, wires up file adapters. Falls back to empty defaults.
- `manifest.json` — MCPB manifest v0.4. User-configurable `corpusFile` (optional string); demo mode (empty corpus) when not set. Targets Node 18+, all three platforms.
- `scripts/build-mcpb.ts` — bundles `src/mcpb-entry.ts` via esbuild (ESM, `--bundle --platform=node`) into `dist/mcpb/server/index.mjs`, copies manifest and icon, then invokes `@anthropic-ai/mcpb pack`.
- `esbuild ^0.24` added to `devDependencies`.
- `build:mcpb` script added to `package.json`.

Corpus JSON format: `{ regulation[], tests[], checks[], playbooks[], taxonomy[] }` — all surfaces optional.

## Tool description improvements

- `search_regulation`: Added return shape (Regulation array with id/citation/text/commentary), pointer to `get_referrers` as next step, and clarified latest-only constraint with `as_of` fallback — was a single sentence with no return shape and no next-step guidance.
- `get_regulation`: Added return shape (citation, verbatim text, commentary), `as_of` use-case example, and pointer to `get_referrers` — was only the `as_of` hint with no context on when to call it or what comes back.
- `search_tests`: Added return shape (id/name/family/aliases/purpose/acceptance_criteria), note that aliases match bank-specific names, and pointer to `get_test` — was one bare sentence.
- `get_test`: Added return shape including `family` (equivalence group), note on how to use family for bank-variant reasoning, and pointer to `get_referrers` — was missing return shape and next-step guidance.
- `search_checks`: Added return shape (id/name/derived_from/expectation), pointer to `get_check`, and pointer to `get_regulation` on `derived_from` ids — was one bare sentence.
- `get_check`: Added return shape including `derived_from` (RegulationId[]) and pointer to `get_regulation` for the underlying law — was "Fetch a check by ID." with no further content.
- `search_playbooks`: Added return shape (id/area/subarea) and pointer to `get_playbook` for phases — was one bare sentence.
- `get_playbook`: Added return shape (phases with mixed-surface references array) and pointer to `get_regulation`/`get_test`/`get_check` for resolving references — was missing return shape and next-step guidance.

## Demo data fix

- `regulation://crr/180` text: Removed "long-run averages" phrasing (that detail lives in 180/1/a). The old text caused `search_regulation "long-run average"` to return CRR 180 *and* CRR 180/1/a instead of the CRR 180/1/a + EBA GL para 78 the README table specifies.
- `regulation://eba/gl-2017-16/78` text: Added "long-run average default rate" phrasing so the search correctly hits this entry, matching the README table contract.

## Demo comment fix

- `examples/inmemory-demo.ts` header comment: Changed `pnpm install` / `pnpm run demo` to `bun install` / `bun run demo` — the project uses Bun, not pnpm.

## Tests

- Added test: registers expected surface area (14 tools, 4 resource templates, 3 prompts) — tripwire against accidental registration drift.
- Added test: `get_referrers("regulation://crr/180/1/a")` with in-memory adapters returns `checks: ["check://lra-pd-derived"]`, `playbooks: ["playbook://calibration/pd"]`, and empty regulation/tests arrays — exercises cross-reference logic end-to-end.

## NOT FIXED

- `regulation://crr/180` is a parent-article stub without version history; the `as_of` code path for it is untested. Out of scope — no table entry exercises it and adding history would expand the demo beyond the brief.
