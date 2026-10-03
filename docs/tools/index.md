# Tools overview

19 tools across six files. Every tool has a title, a description, read-only annotations, a zod input schema, and a handler that delegates to the adapter layer.

## All tools

| Tool | Surface | Description |
|---|---|---|
| `get_corpus_info` | meta | What's loaded — counts, coverage, stale sources |
| `get_referrers` | meta | Everything that references a given ID |
| `resolve_citation` | meta | Loose prose citation → structured Regulation |
| `list_review_areas` | meta | Taxonomy of review areas — authored, or derived from the playbooks |
| `expand_playbook` | meta | Playbook with all Phase.references resolved inline |
| `get_area_overview` | meta | One-shot entry point: area node + expanded playbooks + deduplicated IDs |
| `expand_regulation` | meta | Regulation with its children (sub-regs + checks/tests) resolved inline |
| `get_regulation_tree` | meta | Recursive dossier: a branch of law with operationalizing checks/tests |
| `get_coverage_gaps` | meta | Regulations with no check/test coverage — the aggregate inverse of get_referrers |
| `search_regulation` | regulation | Ranked search over citation, text, and commentary |
| `get_regulation` | regulation | Fetch a regulation paragraph by URI, with optional `as_of` |
| `search_tests` | tests | Ranked search over test name, aliases, family, purpose, criteria |
| `get_test` | tests | Fetch a test by ID |
| `search_checks` | checks | Ranked search over check name, expectation, expected evidence |
| `get_check` | checks | Fetch a check by ID |
| `search_playbooks` | playbooks | Ranked search over area, subarea, phase names and descriptions |
| `get_playbook` | playbooks | Fetch a playbook by ID (`detail: "steps"` drops the reference lists) |
| `list_sources` | sources | The source-document registry with currency status, optionally filtered |
| `get_source` | sources | Fetch a source document record by ID |

`list_sources` is deliberately a list, not a search: the registry is small and status-filterable, so enumerating beats matching.

## Conventions every tool follows

- **Annotations** — every tool declares `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`. The whole server reads a local knowledge base and nothing else.
- **Structured output** — tools with an output schema return `structuredContent` plus a JSON text fallback (the spec requires text alongside structured content).
- **Misses are `isError`** — an unknown id or slug comes back as an `isError` result with a pointer to the right search/list tool, never the literal string `"null"`. Resource reads miss with JSON-RPC error `-32002`.
- **The search envelope** — the four `search_*` tools share `{ results, returned, total_matches, offset, truncated, next_offset, query_tokens, best_coverage, notice }` with `limit` (default 20, max 100) and `offset` paging. `returned` is this page; `total_matches` is the whole match set — ranking is uncapped, so page with `next_offset` until it is null before concluding anything is absent. Queries are ranked and field-scoped, minimum 2 characters — search never enumerates the corpus; that's what `list_*` tools and traversal are for.
- **Rows say how much of the query they matched** — a concise row carries `coverage`, the number of the query's distinct meaningful terms (`query_tokens`, stopwords excluded exactly as ranking excludes them) it matched, and the envelope carries `best_coverage`, the highest over the whole ranked set rather than the page. When `best_coverage` is under half of `query_tokens`, `notice` says the best result matches only some of the terms, that the topic may not be in this corpus, and that a weak match is a statement about the corpus and not about the law. Ranking, `total_matches` and the page contents are unchanged: there is no relevance floor and no cap, only a statement of what the top of the list is worth. `coverage` counts whole-word matches, so a stem or fragment that places records on partial-word matches alone reports coverage 0; a single-term query never carries the notice, and a multi-term query whose hits are all partial-word gets a notice that says so instead of the topic-may-be-absent wording. Nothing matched means no `best_coverage` and no such notice.
- **Responses are size-capped** — a page is shortened until its rows fit the per-response ceiling (~6,000 tokens), and a bundle whose `detail: 'full'` form does not fit is served as its summary instead. Either way `notice` says what happened and how to reach the rest. Nothing is dropped silently.
- **Ranking is coverage-first** — results are ordered by how many of the query's distinct tokens a record matches, and only then by weighted score. A multi-word query is otherwise an OR: a record matching just the commonest token can outrank one matching every token, because score is a sum. Single-token queries are unaffected (coverage is 1 everywhere, so score alone decides). Practical consequence: **more words narrow the result set** rather than widening it, so prefer `"downturn LGD calibration"` over `"LGD"`.
- **`detail: "concise" | "full"`** — search and traversal tools are concise by default (per-surface projections, `{ type, id, label }` reference stubs); pass `detail: "full"` for complete records.
- **Lenient ids** — id parameters tolerate surrounding whitespace, quotes, brackets, and trailing punctuation.

## URI scheme quick-reference

```
regulation://{framework}/{article}[/{paragraph}[/{point}]]
  e.g.  regulation://crr/178/1/a
        regulation://eba/gl-2017-16/78

test://[{family}/]{test-id}
  e.g.  test://jeffreys
        test://gl-2019-03/downturn-lgd-vs-reference-value-comparison

check://{area}/{topic}[/{specific}]
  e.g.  check://calibration/pd/lra-derived
        check://default-definition/utp

playbook://{area}[/{subarea}]
  e.g.  playbook://calibration/pd
        playbook://default-definition

source://{framework}/{document-id}
  e.g.  source://eba/gl-2017-16
        source://crr/575-2013
```

## Workflow patterns

**Starting a review area:** `list_review_areas` → `get_area_overview` (takes the slug or the area name) → work through expanded phases.

**Resolving a bank citation:** `resolve_citation("Art. 178(1)(a)")` → `get_regulation` → `get_referrers` → checks + playbooks.

**Checking test equivalence:** `search_tests("chi-squared decile")` → compare `family` field → read `acceptance_criteria`.

**Historical regulation lookup:** `get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")` → see what was in force when the model was built.

## Which tool, when?

Start from what you already have:

| You have | Start with | Then |
|---|---|---|
| A review task | `list_review_areas` | `get_area_overview` |
| A prose citation | `resolve_citation` | `get_regulation` → `get_referrers` |
| A bank's test name | `search_tests` | `get_test` (compare `family`) |
| A finding | `search_checks` | `resolve_citation` |

Most chains stop after one or two more calls — `get_referrers` after a regulation, `get_test` after a search hit, `expand_playbook` after `get_area_overview` if you skipped the overview.
