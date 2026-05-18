# Meta tools

Six cross-cutting tools that operate across all four surfaces. Defined in `src/tools/meta.ts`.

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
```
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
```
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
```
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
```
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
```
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
```
get_area_overview("calibration.pd")
→ {
    area: { id: "calibration.pd", name: "PD Calibration", ... },
    playbooks: [ ... expanded playbook ... ],
    regulation_ids: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    check_ids:      ["check://calibration/pd/lra-derived", "check://calibration/pd/segment-tested"],
    test_ids:       ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"]
  }
```
