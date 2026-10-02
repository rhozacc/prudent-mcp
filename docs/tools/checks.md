# Checks tools

Two tools for the checks surface. Defined in `src/tools/checks.ts`.

Checks are qualitative expectations with a concrete pass/fail bar, traced back to law via `derived_from: RegulationId[]`. Without `derived_from`, a check is just an opinion; with it, the expectation chains directly to CRR or EBA GL.

---

## `search_checks`

Ranked, field-scoped search across the catalog of qualitative checks: name (weight 3), expectation (2), expected evidence (1).

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Minimum 2 characters |
| `limit` / `offset` | `number` | Optional paging (default 20 per page) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** the shared envelope `{ results, returned, total_matches, offset, truncated, next_offset, query_tokens, best_coverage, notice }`. Concise results are `{ id, name, expectation_first_sentence, derived_from }`; `detail: "full"` serves complete records. Concise rows also carry `coverage` — how many of the query's `query_tokens` meaningful terms that row matched; `best_coverage` is the highest of any row across the whole ranked set (page 2 still reports it), and `notice` says so when the best match covers fewer than half the terms. `detail: "full"` records are not decorated; the envelope fields still appear.

**Example:**
```ts
search_checks("long-run average")
→ { results: [{ id: "check://calibration/pd/lra-derived", name: "PD long-run average derived from sufficient history", expectation_first_sentence: "PD long-run average is computed over a period containing at least one full economic cycle…", derived_from: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"] }], total_matches: 1, offset: 0, truncated: false }
```

Use `get_regulation` on any `derived_from` id to read the underlying law.

---

## `get_check`

Fetch a check by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `CheckId` | e.g. `check://calibration/pd/lra-derived` |

**Returns:** `Check` — unknown ids are an `isError` result pointing at `search_checks`.

```ts
type Check = {
  id: CheckId;
  name: string;
  derived_from: RegulationId[];    // typed — rejects TestId at compile time
  expectation: string;             // concrete "pass" description
  expected_evidence: string[];     // artifacts the reviewer must gather
  last_updated: string;
}
```

**On `expected_evidence`:**

Machine-readable artifact list. Each entry names a specific document, dataset, or output the reviewer needs to verify the check — e.g. "Default rate time series covering the stated LRA period". Downstream tooling can use this to generate review checklists or verify document completeness.

**Example:**
```ts
get_check("check://calibration/pd/lra-derived")
→ {
    name: "PD long-run average derived from sufficient history",
    derived_from: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    expectation: "PD long-run average is computed over a period containing at least one full economic cycle, with a minimum of five years of default data...",
    expected_evidence: [
      "Default rate time series covering the stated LRA period",
      "Economic cycle justification",
      "Reconciliation of historical default definition to currently applied definition"
    ]
  }
```

### Check URI format

Checks use a hierarchical URI: `check://{area}/{topic}[/{specific}]`

Examples:
- `check://calibration/pd/lra-derived`
- `check://calibration/pd/segment-tested`
- `check://default-definition/utp`
- `check://default-definition/90dpd`

The hierarchy mirrors the review area taxonomy. `area` matches a `ReviewArea.id` top-level slug; `topic` is the review sub-topic; `specific` is optional for further granularity.
