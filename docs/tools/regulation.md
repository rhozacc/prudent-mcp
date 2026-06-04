# Regulation tools

Two tools for the regulation surface. Defined in `src/tools/regulation.ts`.

Regulation is the only versioned surface — records carry a `document_version`, and `get_regulation` accepts `as_of` for historical lookups.

---

## `search_regulation`

Full-text search across all loaded regulatory frameworks.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Free-text — matches against citation, text, and commentary |

**Returns:** `Regulation[]` — latest versions only.

**Example:**
```ts
search_regulation("long-run average")
→ [
    { id: "regulation://crr/180/1/a",       citation: "CRR Article 180(1)(a)", ... },
    { id: "regulation://eba/gl-2017-16/78", citation: "EBA GL 2017/16 para 78", ... }
  ]
```

Use `get_referrers` on any returned id to find the checks and playbooks that operationalise it. Use `get_regulation` with `as_of` for historical versions.

---

## `get_regulation`

Fetch a regulation paragraph by URI.

**Inputs:**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `id` | `RegulationId` | yes | e.g. `regulation://crr/178/1/a` |
| `as_of` | `string` (ISO date) | no | Returns the version in force on this date |

**Returns:** `Regulation | null`

```ts
type Regulation = {
  id: RegulationId;
  framework: string;
  document_id: string;
  document_version: string;       // e.g. "2024-01-09"
  citation: string;
  text: string;
  commentary: Commentary[];
  parent?: RegulationId;          // the regulation record this one nests under (a section, or the parent article)
  children: RegulationChildId[];  // sub-regulations + the checks/tests that operationalize this record
}

// RegulationChildId = RegulationId | TestId | CheckId
```

`children` mixes structure and operationalization: a section lists its paragraphs, and any record can list the `check://`/`test://` URIs that hang off it. A child check/test must also name this regulation in its own `derived_from` / `regulatory_basis` (the mirror invariant), so `get_referrers` stays the single computed reverse index. A `PlaybookId` is rejected here at compile time — playbooks reference regulation, never the other way around.

**Example — latest:**
```ts
get_regulation("regulation://crr/178/1/b")
→ { document_version: "2024-01-09", text: "...materiality assessed against thresholds set in the relevant Commission Delegated Regulation..." }
```

**Example — historical:**
```ts
get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")
→ { document_version: "2013-06-26", text: "...Materiality is left to national competent authority discretion." }
```

The `as_of` parameter is what makes cross-vintage model reviews tractable — you can see exactly what the regulation said when the model was built, not just what it says now.
