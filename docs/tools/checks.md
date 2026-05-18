# Checks tools

Two tools for the checks surface. Defined in `src/tools/checks.ts`.

Checks are qualitative expectations with a concrete pass/fail bar, traced back to law via `derived_from: RegulationId[]`. Without `derived_from`, a check is just an opinion; with it, the expectation chains directly to CRR or EBA GL.

---

## `search_checks`

Full-text search across the catalog of qualitative checks.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Matches against name, expectation, and derived_from |

**Returns:** `Check[]` — includes `id`, `name`, `derived_from`, `expectation`, and `expected_evidence`.

**Example:**
```
search_checks("long-run average")
→ [{ id: "check://calibration/pd/lra-derived", name: "PD long-run average derived from sufficient history", ... }]
```

Use `get_regulation` on any `derived_from` id to read the underlying law.

---

## `get_check`

Fetch a check by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `CheckId` | e.g. `check://calibration/pd/lra-derived` |

**Returns:** `Check | null`

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
```
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
