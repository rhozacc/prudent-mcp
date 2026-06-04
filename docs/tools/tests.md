# Tests tools

Two tools for the tests surface. Defined in `src/tools/tests.ts`.

The tests surface describes statistical tests — what they measure, when to use them, how to read their output. The MCP never executes tests; computation lives in the host or in `prudent-runtime`.

---

## `search_tests`

Full-text search across the catalog of described statistical tests.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Matches against name, aliases, purpose, and family |

**Returns:** `Test[]`

Particularly useful for matching bank-specific test names to corpus entries — banks often use variant names for the same underlying method. The `family` field is the equivalence key.

**Example:**
```ts
search_tests("chi-squared decile")
→ [{ id: "test://hosmer-lemeshow", name: "Hosmer-Lemeshow test", aliases: ["HL test", "HL chi-squared", "modified HL"], family: "calibration-grouped" }]
```

---

## `get_test`

Fetch a test by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `TestId` | e.g. `test://jeffreys` |

**Returns:** `Test | null`

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
