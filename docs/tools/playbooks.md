# Playbooks tools

Two tools for the playbooks surface. Defined in `src/tools/playbooks.ts`.

Playbooks are guided walkthroughs structured as ordered phases. Each phase has a description and a `references` array that mixes regulation, test, check, and nested playbook IDs. Use `expand_playbook` (in [meta tools](./meta)) when you need all references resolved inline in a single call.

---

## `search_playbooks`

Full-text search across the catalog of validation playbooks.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Matches against area, subarea, and phase descriptions |

**Returns:** `Playbook[]` — summary only (`id`, `area`, `subarea`). Use `get_playbook` for the full record.

**Example:**
```
search_playbooks("calibration")
→ [
    { id: "playbook://calibration/pd",  area: "calibration", subarea: "pd" },
    { id: "playbook://calibration/lgd", area: "calibration", subarea: "lgd" }
  ]
```

---

## `get_playbook`

Fetch a playbook by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `PlaybookId` | e.g. `playbook://calibration/pd` |

**Returns:** `Playbook | null`

```ts
type Playbook = {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: Phase[];
  gates: string[];       // pass/fail conditions between phases
  last_updated: string;
}

type Phase = {
  name: string;
  description: string;
  references: (RegulationId | TestId | CheckId | PlaybookId)[];
}
```

**Example:**
```
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

For inline resolution of all references in one call, use [`expand_playbook`](./meta#expand_playbook).
