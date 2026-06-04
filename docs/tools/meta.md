# Meta tools

Nine cross-cutting tools that operate across all four surfaces. Defined in `src/tools/meta.ts`.

---

## `get_corpus_info`

What's loaded right now. Tells Claude what's actually queryable before it starts fetching things that don't exist.

**Inputs:** none

**Returns:**

```ts
{
  last_updated: string;       // ISO datetime
  counts: {
    regulation: number;
    test: number;
    check: number;
    playbook: number;
  };
  coverage: string[];         // e.g. ["CRR", "EBA-GL-2017-16"]
}
```

**Example:**
```ts
get_corpus_info()
→ { last_updated: "2024-10-01T00:00:00Z", counts: { regulation: 12, test: 3, check: 4, playbook: 2 }, coverage: ["CRR", "EBA-GL-2017-16"] }
```

---

## `get_referrers`

Find everything in the corpus that references a given ID. Works on any surface — regulation, test, check, or playbook.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `string` | Any surface ID — `regulation://`, `test://`, `check://`, or `playbook://` |

**Returns:**

```ts
{
  regulation: RegulationId[];
  tests: TestId[];
  checks: CheckId[];
  playbooks: PlaybookId[];
}
```

**Example:**
```ts
get_referrers("regulation://crr/180/1/a")
→ { regulation: [], tests: [], checks: ["check://calibration/pd/lra-derived"], playbooks: ["playbook://calibration/pd"] }
```

---

## `resolve_citation`

Loose, human-prose citation string → structured Regulation record. Handles the full range of citation styles analysts actually use in documents.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `text` | `string` | A loose citation in analyst prose |

**Returns:** `Regulation | null`

**Example:**
```ts
resolve_citation("Art. 178(1)(a)")
→ regulation://crr/178/1/a  (full Regulation record)

resolve_citation("EBA GL on PD-LGD, para 83")
→ regulation://eba/gl-2017-16/83
```

---

## `list_review_areas`

The canonical taxonomy of review areas. Use this to map a real-world analyst task onto the corpus's structure before fetching playbooks or checks.

**Inputs:** none

**Returns:** `ReviewArea[]`

```ts
type ReviewArea = {
  id: string;          // dotted slug, e.g. "calibration.pd"
  name: string;
  parent?: string;
  children: string[];
}
```

**Example:**
```ts
list_review_areas()
→ [
    { id: "calibration",     name: "Calibration",     children: ["calibration.pd", "calibration.lgd"] },
    { id: "calibration.pd",  name: "PD Calibration",  parent: "calibration", children: [] },
    ...
  ]
```

---

## `expand_playbook`

Fetch a playbook with all `Phase.references` resolved inline. Avoids N+1 fetches when an LLM needs to reason about all phases at once.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `PlaybookId` | e.g. `playbook://calibration/pd` |

**Returns:** `ExpandedPlaybook | null`

Each reference in `phases[*].references` becomes `{ type, id, record }` where `record` is the full Regulation / Test / Check / Playbook object (null if not found).

**Example:**
```ts
expand_playbook("playbook://calibration/pd")
→ {
    id: "playbook://calibration/pd",
    phases: [
      {
        name: "Validate LRA derivation",
        references: [
          { type: "regulation", id: "regulation://crr/180/1/a", record: { ... } },
          { type: "check",      id: "check://calibration/pd/lra-derived", record: { ... } }
        ]
      },
      ...
    ]
  }
```

---

## `get_area_overview`

One-shot entry point for a review area. Combines `list_review_areas` + all matching playbooks + `expand_playbook` + deduplication into a single call.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `area` | `string` | Canonical area slug — use `list_review_areas` first to confirm |

**Returns:** `AreaOverview | null`

```ts
type AreaOverview = {
  area: ReviewArea;
  playbooks: ExpandedPlaybook[];
  regulation_ids: RegulationId[];   // deduplicated across all phases
  check_ids: CheckId[];
  test_ids: TestId[];
}
```

**Example:**
```ts
get_area_overview("calibration.pd")
→ {
    area: { id: "calibration.pd", name: "PD Calibration", ... },
    playbooks: [ ... expanded playbook ... ],
    regulation_ids: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    check_ids:      ["check://calibration/pd/lra-derived", "check://calibration/pd/segment-tested"],
    test_ids:       ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"]
  }
```

---

## `expand_regulation`

Fetch a regulation with its children resolved inline — sub-regulations plus the checks/tests that operationalize it. The reverse-direction companion to `expand_playbook`: avoids N+1 fetches when you want an article *and everything hanging off it* in one call.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `RegulationId` | e.g. `regulation://crr/180/1/a` |
| `as_of` | `string` (ISO date) | Optional — resolve the regulation as of this date |

**Returns:** `ExpandedRegulation | null`

```ts
type ExpandedRegulation = {
  id: RegulationId;
  citation: string;
  framework: string;
  document_version: string;
  text: string;
  parent: RegulationId | null;
  children: { type, id, record }[];   // record is the full Regulation | Test | Check (null if not found)
}
```

**Example:**
```ts
expand_regulation("regulation://crr/180/1/a")
→ {
    id: "regulation://crr/180/1/a",
    citation: "CRR Article 180(1)(a)",
    children: [
      { type: "check", id: "check://calibration/pd/lra-derived", record: { ... } }
    ]
  }
```

---

## `get_regulation_tree`

Walk a regulation's children recursively into a dossier: the branch of law (section → paragraphs) with the checks/tests that operationalize each node attached as leaves.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `RegulationId` | Root of the tree, e.g. `regulation://crr/180` |
| `depth` | `number` | Optional — max regulation recursion depth (default 5, max 10) |
| `as_of` | `string` (ISO date) | Optional — resolve regulations as of this date |

**Returns:** `RegulationTreeNode | null`

Regulation children recurse; checks/tests are resolved leaves. A node cut off by the depth limit or a reference cycle is flagged `truncated: true`.

```ts
type RegulationTreeNode = {
  type: "regulation";
  id: RegulationId;
  citation: string;
  record: Regulation | null;
  children: (RegulationTreeNode | { type: "test" | "check"; id; record })[];
  truncated?: boolean;
}
```

**Example:**
```ts
get_regulation_tree("regulation://crr/180")
→ {
    type: "regulation", id: "regulation://crr/180", citation: "CRR Article 180",
    children: [
      { type: "regulation", id: "regulation://crr/180/1/a", children: [
        { type: "check", id: "check://calibration/pd/lra-derived", record: { ... } }
      ]},
      { type: "check", id: "check://calibration/pd/segment-tested", record: { ... } }
    ]
  }
```

---

## `get_coverage_gaps`

Audit the corpus for regulatory requirements with no validation coverage — regulations that no check (`derived_from`) or test (`regulatory_basis`) points at. The aggregate inverse of `get_referrers`: "show me the law we have no check or test for."

**Inputs:** none

**Returns:** `CoverageReport`

```ts
type CoverageReport = {
  total_regulations: number;
  covered: number;
  uncovered: { id: RegulationId; citation: string; is_leaf: boolean }[];
}
```

`is_leaf` distinguishes a real gap (a leaf paragraph with no coverage) from a section that may inherit coverage from its children.

**Example:**
```ts
get_coverage_gaps()
→ {
    total_regulations: 6, covered: 5,
    uncovered: [
      { id: "regulation://eba/gl-2017-16/s4", citation: "EBA GL 2017/16 Section 4 …", is_leaf: false }
    ]
  }
```
