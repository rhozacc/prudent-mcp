# Tools overview

14 tools across six files. Every tool has a description, a zod input schema, and a handler that delegates to the adapter layer.

## All tools

| Tool | Surface | Description |
|---|---|---|
| `get_corpus_info` | meta | What's loaded — counts and coverage |
| `get_referrers` | meta | Everything that references a given ID |
| `resolve_citation` | meta | Loose prose citation → structured Regulation |
| `list_review_areas` | meta | Canonical taxonomy of review areas |
| `expand_playbook` | meta | Playbook with all Phase.references resolved inline |
| `get_area_overview` | meta | One-shot entry point: area node + expanded playbooks + deduplicated IDs |
| `search_regulation` | regulation | Full-text search across all loaded regulatory frameworks |
| `get_regulation` | regulation | Fetch a regulation paragraph by URI, with optional `as_of` |
| `search_tests` | tests | Full-text search across the statistical test catalog |
| `get_test` | tests | Fetch a test by ID |
| `search_checks` | checks | Full-text search across the qualitative check catalog |
| `get_check` | checks | Fetch a check by ID |
| `search_playbooks` | playbooks | Full-text search across the playbook catalog |
| `get_playbook` | playbooks | Fetch a playbook by ID |

## URI scheme quick-reference

```
regulation://{framework}/{article}[/{paragraph}[/{point}]]
  e.g.  regulation://crr/178/1/a
        regulation://eba/gl-2017-16/78

test://{test-id}
  e.g.  test://jeffreys
        test://hosmer-lemeshow

check://{area}/{topic}[/{specific}]
  e.g.  check://calibration/pd/lra-derived
        check://default-definition/utp

playbook://{area}[/{subarea}]
  e.g.  playbook://calibration/pd
        playbook://default-definition
```

## Workflow patterns

**Starting a review area:** `list_review_areas` → confirm slug → `get_area_overview` → work through expanded phases.

**Resolving a bank citation:** `resolve_citation("Art. 178(1)(a)")` → `get_regulation` → `get_referrers` → checks + playbooks.

**Checking test equivalence:** `search_tests("chi-squared decile")` → compare `family` field → read `acceptance_criteria`.

**Historical regulation lookup:** `get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")` → see what was in force when the model was built.
