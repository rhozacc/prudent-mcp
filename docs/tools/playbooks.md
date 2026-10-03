# Playbooks tools

Two tools for the playbooks surface. Defined in `src/tools/playbooks.ts`.

Playbooks are guided walkthroughs structured as ordered phases. Each phase has a description and a `references` array that mixes regulation, test, check, and nested playbook IDs. Use `expand_playbook` (in [meta tools](./meta)) when you need all references resolved inline in a single call.

---

## `search_playbooks`

Ranked, field-scoped search across the catalog of validation playbooks: area and subarea (weight 3), phase names (2), phase descriptions (1).

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Minimum 2 characters |
| `limit` / `offset` | `number` | Optional paging (default 20 per page) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** the shared envelope `{ results, returned, total_matches, offset, truncated, next_offset, query_tokens, best_coverage, notice }`. Concise results are `{ id, area, subarea, phase_count }`; `detail: "full"` serves complete records. Use `expand_playbook` for phases with references resolved inline. Concise rows also carry `coverage` — how many of the query's `query_tokens` meaningful terms that row matched; `best_coverage` is the highest of any row across the whole ranked set (page 2 still reports it), and `notice` says so when the best match covers fewer than half the terms. `detail: "full"` records are not decorated; the envelope fields still appear.

**Example:**
```ts
search_playbooks("calibration")
→ { results: [
    { id: "playbook://calibration/pd",  area: "calibration", subarea: "pd",  phase_count: 3 },
    { id: "playbook://calibration/lgd", area: "calibration", subarea: "lgd", phase_count: 4 }
  ], total_matches: 2, offset: 0, truncated: false }
```

---

## `get_playbook`

Fetch a playbook by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `PlaybookId` | e.g. `playbook://calibration/pd` |
| `detail` | `"full" \| "steps"` | Optional, default `"full"` — `"steps"` replaces each phase's `references` array with its count, and `regulatory_scope` with its size |

**Returns:** `Playbook` (default), or the steps-only projection below — unknown ids are an `isError` result pointing at `search_playbooks`.

Reach for `detail: "steps"` when the question is what the steps *are*. A dense
playbook carries ~90 reference URIs across its phases plus a `regulatory_scope`
of a couple of hundred more; on the real corpus that is 11.7 kB, against 3.2 kB
for the same walkthrough in steps form. Use `expand_playbook` instead when you
intend to *follow* the references.

```ts
type StepsOnlyPlaybook = {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: Array<{ name: string; description: string; reference_count: number }>;
  gates: string[];
  regulatory_scope_count: number;
  last_updated: string;
}
```

```ts
type Playbook = {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: Phase[];
  gates: string[];              // pass/fail conditions between phases
  regulatory_scope: RegulationId[];  // high-level mandate — typically section-level IDs
  last_updated: string;
}

type Phase = {
  name: string;
  description: string;
  references: (RegulationId | TestId | CheckId | PlaybookId)[];
}
```

**Example:**
```ts
get_playbook("playbook://calibration/pd")
→ {
    id: "playbook://calibration/pd",
    phases: [
      {
        name: "Validate LRA derivation",
        references: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78", "check://calibration/pd/lra-derived"]
      },
      {
        name: "Test calibration at grade level",
        references: ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow", "check://calibration/pd/segment-tested"]
      }
    ],
    gates: ["LRA period covers a full economic cycle", "All material grades tested individually"]
  }
```

**`regulatory_scope` vs `Phase.references`:** `regulatory_scope` states the broad regulatory mandate for the entire playbook (e.g., "EBA GL Section 4 governs PD calibration"). `Phase.references` are operational — the specific articles, tests, and checks that apply within a given phase. A section-level ID in `regulatory_scope` tells Claude what framework this playbook is answering to; the phase references tell it what to do.

For inline resolution of all references in one call, use [`expand_playbook`](./meta#expand_playbook).
