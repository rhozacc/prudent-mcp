# Claude Code: prudent-mcp v0.8

This file is the working brief when extending the codebase. For human onboarding read `README.md` and `docs/corpus/index.md` first.

## What this is

An MCP server that exposes a structured knowledge base for IRB credit-risk model validation. Five parallel surfaces — `regulation`, `tests`, `checks`, `playbooks`, `sources` — each with its own URI scheme, plus cross-cutting tools, a review-area taxonomy, and prompt scaffolds. The `sources` surface is the regulatory-context registry: which documents the corpus derives from and whether that context is current.

The server is the **read-only knowledge layer**. No execution, no writes, no orchestration. That boundary is load-bearing.

## What's already here

```
src/
├── server.ts              MCP server + explicit registration of every module
├── schema.ts              zod schemas + template literal URI types
├── adapters.ts            interfaces per surface + empty defaults + handles
├── file-adapter.ts        file-based adapters loaded from a corpus JSON file (incl. regulation_history + resolveCitationIn)
├── mcpb-entry.ts          MCPB entry point (wires file-adapter or empty defaults; startup integrity gate)
├── areas.ts               review-area keys — the ONE slug/prose definition (derives the taxonomy)
├── referrers.ts           computeReferrers — the ONE reverse index every adapter delegates to
├── search.ts              rankedSearch + per-surface field sets — the ONE ranking definition (uncapped; stopword-filtered; whole-sentence excerpts)
├── resources.ts           URI templates mirroring the schemes (completions; misses are -32002)
├── tools/                 meta (incl. traversal tools) + one file per surface + shared.ts (envelopes, size ceilings, annotations, leniency)
└── prompts/               three prompt scaffolds

manifest.json              MCPB manifest v0.4
examples/inmemory-demo.ts  seeded in-memory server, runnable end-to-end
scripts/generate-schemas.ts  zod → JSON Schema export (chained to also write the schema reference page)
scripts/schema-registry.ts   shared named-schema list (generator, schema-docs, drift test)
scripts/generate-schema-docs.ts  regenerates docs/corpus/schemas.md (rendered schema reference)
scripts/list-all.ts          prints full corpus overview to stdout
scripts/validate-corpus.ts   integrity linter (mirror invariant, dangling refs, cycles, source supersession, verbatim text; warns on stale sources); CI-able
scripts/generate-graph.ts    regenerates docs/corpus/graph.md (Mermaid corpus map)
scripts/build-mcpb.ts        bundle src/mcpb-entry.ts + pack .mcpb
docs/                      architecture, corpus structure, schema reference, corpus graph
tests/smoke.test.ts        construction + traversal smoke tests + MCP wire contracts
tests/areas.test.ts        review-area keys, derived taxonomy, prose resolution
tests/schema.test.ts       schema validation + generative URI tests
tests/schema-drift.test.ts golden test: committed JSON Schemas match the zod defs
tests/validate.test.ts     validator rules (source supersession, staleness warnings, URI-safe ids)
tests/response-size.test.ts  the response ceiling: paginate shortening, fitOrCompact, one encoder
tests/search.test.ts       ranking, coverage, stopwords, whole-sentence excerpts
tests/file-adapter.test.ts corpus file loading, as_of history, citation resolution refusals
evals/                     context-quality invariants over call traces (see evals/README.md)
```

Every tool, resource, and prompt has a description, a zod input schema, and a handler. In the open-source distribution the default adapters return empty results. The in-memory demo reassigns adapter handles to seed real content for development and inspection.

## Stack

Bun. TypeScript strict. `@modelcontextprotocol/sdk` (TS-first). zod for runtime validation, template literal types (`type RegulationId = `regulation://${string}``) for compile-time URI segregation.

`bun run typecheck`, `bun test`, `bun run inspect:demo`, `bun run schemas`, `bun run validate`, `bun run graph`, `bun run evals`, `bun run build:mcpb`. `bun run test:ci` runs typecheck + tests + linter + **evals** — the context-quality suite is a gate now, not a report, so a fatal finding fails the build. No `tsc` build step for local dev.

## What to do when extending

1. Read `src/schema.ts` and `docs/corpus/index.md` together — schema decisions all map to a use case.
2. `bun install && bun run typecheck && bun test`.
3. `bun run inspect:demo` — exercise the surface end-to-end.
4. Make your change. Strict mode catches things; trust the type errors.
5. If you change schemas, run `bun run schemas` and commit the regenerated JSON Schemas under `docs/schemas/`.

## Schema decisions worth understanding before extending

- **Template literal URI types** — `Check.derived_from: RegulationId[]` rejects a `TestId` at compile time. Don't widen to `string[]`.
- **`Regulation.children` is mixed but typed** — `RegulationChildId = RegulationId | TestId | CheckId`. A record nests sub-regulations *and* the checks/tests that operationalize it; a `PlaybookId` is rejected at compile time. It stays the denormalized inverse of `parent`, which now also lives on `Check`/`Test`. **Mirror invariant:** a check/test listed as a child must also name that regulation in `derived_from`/`regulatory_basis` (and point back via `parent`), so `get_referrers` remains the single computed reverse index — don't add a second scan over `children`.
- `Check.derived_from` + `Check.expectation` + `Check.expected_evidence` — traceability from supervisor expectations back to law, plus the concrete artifacts a reviewer must gather. Without `derived_from`, a Check is opinion. Without `expected_evidence`, it's underspecified.
- **Check URI shape** — `check://{area}/{topic}[/{specific}]` (e.g. `check://calibration/pd/lra-derived`). Hierarchical, consistent with `regulation://`. Don't flatten back to `check://slug`.
- **`Source` is a currency registry, not referenced content** — `source://{framework}/{document-id}`, latest-only (supersession = `status` + `superseded_by`, linter-enforced: the two imply each other, pointers resolve, chains are acyclic). It stays out of `children`, `get_referrers`, `AnyId`, and the mirror invariant; the join to regulation is `framework` + `document_id` string equality, computed where needed. `verified` drives the 30-day staleness surfaced by `get_corpus_info.stale_sources` and `bun run validate` warnings; `milestones` are chronological display strings (never parsed) and `milestones[0]` is served as `next_milestone`. Maintenance = `/maintain-context` session edits gated by the linter, never write tools.
- **Review areas are keyed in ONE place (`src/areas.ts`)** — playbooks carry `area`/`subarea` as free-form prose from extraction ("PD Estimation"); the taxonomy addresses the same nodes by dotted slug. `areaKey`/`resolveArea`/`playbookInArea` are the only definitions of that mapping, and `get_area_overview` accepts either spelling. Two consequences worth keeping: an authored `taxonomy` in the corpus always wins, and when there is none it is **derived from the playbooks present** rather than served as `[]` — an empty taxonomy takes `list_review_areas` AND `get_area_overview` out of service, which is the documented entry path. Don't reimplement the `p.area === area` filter anywhere; that comparison is a slug against prose and can never match.
- **Search ranks by COVERAGE first, then score** — score is a sum over query tokens, so on the real corpus "long run average default rate" matches 707 of 1,365 regulations and "margin of conservatism data quality" matches 984 of 1,107 checks. Summing alone let a record matching only the commonest token outrank one matching every token. `SearchMatch` carries `coverage` and `query_tokens`; a single-token query has coverage 1 everywhere and falls through to score exactly as before. Don't "simplify" the sort back to score.
- **`list()` vs `search()` on every content adapter** — `list()` returns ALL records and is the enumeration/traversal contract (cross-cutting tools, scripts, validators, completions). `search(query)` is ranked, field-scoped relevance search via `src/search.ts` (`rankedSearch`, per-surface field sets, **no cap** — the tool layer pages); an empty/whitespace query returns `[]`. Never lean on `search("")` to enumerate — that undocumented contract is gone, and the tool layer rejects sub-2-char queries anyway. The one-call corpus dump mattered: the corpus is the paid product.
- **Ranking returns everything; the TOOL layer pages** — `rankedSearch` used to slice to 20 before `paginate` counted, so `total_matches` reported a page size on every query of every surface, and paging past it returned nothing — which made the obvious way to verify the number confirm it. `DEFAULT_LIMIT` is `Infinity`; `total_matches` is `all.length`. Don't reintroduce a cap inside ranking.
- **Query tokens are stopword-filtered; excerpts are whole sentences** — `"of"` substring-matches inside "proof", which handed every record a free point of `coverage` (the primary sort key) and pinned the excerpt window to the head of the record. Filtering is by list, never by length: a legal point segment (`180(1)(a)`) is one character and carries meaning. `makeExcerpt` then returns a run of WHOLE sentences around the densest hit cluster — an excerpt cut mid-clause cannot be quoted, so the caller opens the full record anyway and the excerpt has cost tokens for nothing. A legal act numbers its obligations `(a) …; (b) …;` with no terminator until the end, so `sentenceSpans` sees one span for the whole article: 992 of 5,629 spans exceed the window and hold 44.3% of all regulation text. For those the window falls back to the nearest CLAUSE end (`. ! ? ;`, never `:`) — fixing it in `sentenceSpans` instead orphans enumerated limbs from their stem (3.3% → 15.4%), which is worse than a long excerpt. The head never snaps forward onto a limb: an excerpt starting at "(b)" has lost the sentence that says what (b) is a list of.
- **One response, one size ceiling** — `serialize` (compact, not indented) is the single encoder for every tool body AND the thing every budget measures, so a page shortened to fit cannot arrive larger. `paginate` shrinks the page until the rows fit `RESPONSE_CHAR_BUDGET` (never to zero: an empty page reads as "no matches"), and `fitOrCompact` serves a bundle's compact form when its full form does not fit. Both say so in `notice`. Nothing is ever dropped silently — `search_regulation(detail:'full')` caps `commentary` and declares `commentary_omitted`, because a handful of section records carry 40-56 entries and one of them serialized to 33,000 characters.
- **`resolve_citation` declines** — `resolveCitationDetailed` returns `CitationResolution` (`match`, `confidence`, `candidates`, `ambiguous`, `unmatched_segments`, `coverage_note`), never a bare `Regulation | null`. Matching is exact, in order: instrument gate (a citation naming an instrument the corpus does not hold resolves to null with a note, never into another document that shares a number) → exact citation equality → exact numeric-SPINE equality scoped to the document the citation names → narrower relatives reported as candidates with `match` still null → the MIRROR of that, the containing provision, reported the same way. Containment and suffix matching as *matching* are gone: they made "Article 1218" resolve to 121 and "Article 178 of the CRR" land on whatever document had a 178, with no way to tell a hit from a guess. The container mirror is not that returning — `match` stays null and `confidence` stays `"none"`; it only stops the corpus saying "nothing is numbered 181.1.b" about a point it serves verbatim inside Article 181 (377 → 124 bare misses over the 456 targets the corpus asserts about itself, 0 match flips). Two guards make it safe and both are load-bearing: a record whose citation reduces to an empty or non-faithful spine is a prefix of everything (`Section P3.TIV.C1b.S2b-3` reduces to `["3"]`), and spine tokens are compared JOINED ON A SEPARATOR — `"article41"` was once both `Article 4(1)` and `Article 41`. **A confident wrong citation is the worst failure this server can produce.** Don't add a fuzzy fallback, and don't fold candidates into `match`.
- **Optional record fields are OPTIONAL, not defaulted — absent is not empty** — `Regulation.citation_aliases/kind/obligation/pages/anchor/is_metadata_only/cites` and `Check/Test.primary_basis` are all `.optional()`. `pages: []` asserts the text was read from no page; `pages` missing says the corpus never captured it. Defaulting them would erase that distinction, which is the same defect as `next_milestone` reading "nothing upcoming" for a registry where milestones were never populated. A corpus that omits them all behaves exactly as before.
- **`citation_aliases` resolve, at their own confidence level** — an alias hit returns `confidence: "alias"` plus a note naming the record's real citation, never `"exact"`. The caller asked for a label the record does not carry: EBA guidelines number paragraphs, and "Article 178" is simultaneously a real CRR article. Fold `"alias"` into `"exact"` and the collision the relabel fixed comes straight back.
- **`get_referrers.primary` is the discriminating half** — `derived_from` is a span (a median of 23 ids, because a check read off a section is traced to the whole section), so the flat lists return the same answer for every article in that section. `primary_basis` names what a check restates; `computeReferrers` splits it out and the tool tells the caller to prefer it. Empty on a corpus that carries none, which is distinguishable from "nothing restates this".
- **Published output schemas are OPEN** — every tool that declares an `outputSchema` declares it with `.passthrough()`, at the declaration site only (the canonical record schemas in `src/schema.ts` stay closed, and the registered JSON Schemas under `docs/schemas/` are byte-identical). A closed envelope publishes `additionalProperties: false`, so a spec-following client REJECTS a response carrying a key the schema does not name — which turns every additive field into a breaking change for exactly the careful clients. `miss()` is contract-free because the SDK returns before validation when `isError` is true. Don't "tighten" these back.
- **The instructions block carries RULES about the EDGE of the corpus, not facts about one** — scope (a bounded corpus; absence from it is not absence from the law; `get_coverage_gaps` measures coverage of provisions by checks INSIDE the corpus, never coverage of the law by the corpus), answering past the boundary (neither truncate at it nor blend across it — label what is not traceable to a record id, and never serve a pre-adoption `xx/xx` placeholder as current law), and legal force vs drafting register (`obligation` is how one provision is WORDED and `doc_type` is a format label; neither carries tier — resolve force from the empowering provision's served text). They are there because a grounded answer once lost to an ungrounded one on precisely this: the server was authoritative about what it held and silent about everything else, so the model took the corpus boundary for the boundary of the subject. They cost ~537 tokens, they are counted in `surfaceTokens`, and they are rules rather than facts because this repo is public and corpus-agnostic.
- **Ids must survive being written down (linter rule 7)** — `[^A-Za-z0-9:/._-]` in any id is fatal. An id is copied out of one response into the next call, usually inside prose, and every URI extractor stops at a bracket: an id ending in `(part2)` reached `get_check` as `…/2(part2`, which reads as "no such record".
- **`regulation_history` + the `as_of` rule** — the corpus file's optional `regulation_history` key (`{ id, effective_from, record }` entries) powers `get(id, asOf)`: no history for the id → current record, UNLESS the registry says the document did not exist yet (the earliest `published`/`effective_from` across that document's sources) — a 2016 `as_of` against a 2019 guideline is a miss, not today's text relabelled, and that needs no history at all; history present → last entry with `effective_from <= asOf`; asOf predating every entry → `null`, never current text served as historical. The current version is asOf-selectable only via a current-boundary entry. `RegulationHistoryEntrySchema` is exported but deliberately NOT in `scripts/schema-registry.ts` (it's file-format plumbing, not a surface schema).
- `Test.family` + `Test.aliases` + `Test.acceptance_criteria` — equivalence reasoning across bank-specific test variants.
- `Regulation.commentary` — interpretive material (Q&A, supervisor letters), source-attributed.
- `Playbook.phases` — structured walkthrough with mixed-surface references in each phase.
- `ReviewArea` — canonical taxonomy. The map from "what an analyst is doing" to "what's in the corpus."

## Design constraints

- Read-only. No write tools.
- No execution. The server describes; computation lives elsewhere.
- Versioning only on `Regulation`. Other surfaces always serve latest; source supersession is a `status` + pointer, not history.
- URI schemes match surface names.
- Cross-surface references are typed.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Keep both on.
- **Licensing is settled — don't drift it.** The server code is AGPL-3.0-only
  (`LICENSE`, `package.json`, `manifest.json`, `README.md` and `docs/index.md` must
  all agree). The corpus is proprietary, licensed separately, and never enters this
  repo. Embedding/OEM/on-prem is offered under a commercial licence instead. The
  copyleft is deliberate: the server ships only a stdio transport, so any hosted
  deployment is a modified work and §13 reaches its transport, auth and metering
  layer — that is the asset being protected, not the corpus, which no code licence
  can reach. Anything bundled into the `.mcpb` needs its notice in
  `THIRD-PARTY-NOTICES.md`.

## Don't add (yet)

- Authentication, rate limiting, telemetry.
- More reference adapters under `examples/`. The in-memory demo is the template; backend-specific adapters belong outside this repo.
- More prompts beyond the existing three scaffolds.

## Surface area

```
Tools:       19   9 cross-cutting + (search + get) × 4 surfaces + (list + get) × 1 registry
                  cross-cutting: get_corpus_info · get_referrers · resolve_citation
                                 list_review_areas · expand_playbook · get_area_overview
                                 expand_regulation · get_regulation_tree · get_coverage_gaps
Templates:    5   one per URI scheme
Prompts:      3   validate_review_area · review_calibration · assess_findings
Schemas:     13   Regulation · Test · Check · Playbook · Source · CorpusInfo
                  · Referrers · Commentary · Phase · Milestone · ReviewArea
                  · CitationResolution · ExternalCitation
```
