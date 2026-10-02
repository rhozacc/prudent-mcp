# Tests tools

Two tools for the tests surface. Defined in `src/tools/tests.ts`.

The tests surface describes statistical tests — what they measure, when to use them, how to read their output. The MCP never executes tests; computation lives in the host or in `prudent-runtime`.

---

## `search_tests`

Ranked, field-scoped search across the catalog of described statistical tests: name and aliases (weight 3), family and purpose (2), acceptance criteria (1).

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Minimum 2 characters |
| `limit` / `offset` | `number` | Optional paging (default 20 per page) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** the shared envelope `{ results, returned, total_matches, offset, truncated, next_offset, query_tokens, best_coverage, notice }`. Concise results are `{ id, name, family, purpose_first_sentence }`; `detail: "full"` serves complete records. Concise rows also carry `coverage` — how many of the query's `query_tokens` meaningful terms that row matched; `best_coverage` is the highest of any row across the whole ranked set (page 2 still reports it), and `notice` says so when the best match covers fewer than half the terms. `detail: "full"` records are not decorated; the envelope fields still appear.

Particularly useful for matching bank-specific test names to corpus entries — banks often use variant names for the same underlying method, and `aliases` is weighted like `name`. The `family` field is the equivalence key.

**Example:**
```ts
search_tests("chi-squared decile")
→ { results: [{ id: "test://hosmer-lemeshow", name: "Hosmer-Lemeshow test", family: "calibration-grouped", purpose_first_sentence: "Goodness-of-fit test that groups predictions into buckets…" }], total_matches: 1, offset: 0, truncated: false }
```

---

## `get_test`

Fetch a test by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `TestId` | e.g. `test://jeffreys` |

**Returns:** `Test` — unknown ids are an `isError` result pointing at `search_tests`.

```ts
type Test = {
  id: TestId;
  name: string;
  aliases: string[];
  family?: string;              // equivalence group — e.g. "calibration-binomial"
  purpose: string;
  acceptance_criteria?: string;
  regulatory_basis: RegulationId[];  // regulations that reference or require this test family
  last_updated: string;
}
```

**On `family` and `aliases`:**

`family` groups methodologically equivalent tests — different banks often run their own variant of the same test. If `family` matches, the method is acceptable as long as the acceptance criteria are met. `aliases` is the matching layer: it maps the names analysts actually write in validation reports to the canonical corpus entry.

**Example:**
```ts
get_test("test://jeffreys")
→ {
    name: "Jeffreys test",
    aliases: ["one-sided Jeffreys", "Bayesian PD test"],
    family: "calibration-binomial",
    purpose: "Bayesian test for PD calibration at the rating grade or pool level...",
    acceptance_criteria: "Posterior probability that the true PD exceeds the estimate is below the chosen significance level (typically one-sided 95%)."
  }
```

Use `get_referrers` to find which playbooks reference this test.
