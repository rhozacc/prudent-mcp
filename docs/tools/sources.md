# Sources tools

Two tools for the sources surface. Defined in `src/tools/sources.ts`.

Sources are the registry of documents the corpus derives from — which EU regulation, EBA guideline, or ECB guide each `document_id` refers to, whether it is current, pending, or superseded, when its currency was last verified against the publisher, and what regulatory milestones approach. The registry is small and list-shaped, so unlike the content surfaces it exposes `list_sources` (optionally filtered by status) rather than a full-text search.

---

## `list_sources`

The full registry — the "is my regulatory context current?" answer.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `status` | `"current" \| "pending" \| "superseded"` | Optional — omit for the whole registry |

**Returns:** `{ sources: [...] }` — one summary per source: `id`, `title`, `doc_type`, `status`, `verified`, `effective_from`, `superseded_by`, `next_milestone` (the first entry of the chronologically ordered milestones array), and `open_pending_changes` — how many of the source's `pending_changes` the corpus has not ingested, computed at serve time. The key is **absent** at zero, so a row with it is a row to open: `get_source` has the entries.

**Example:**
```ts
list_sources({ status: "pending" })
→ { sources: [{ id: "source://eba/cp-2025-14", title: "EBA-CP-2025-14 Consultation on amending the PD/LGD estimation guidelines (CRR3 alignment)", status: "pending", verified: "2026-08-23", next_milestone: { date: "2026-10-19", event: "Consultation closes" }, ... }] }
```

Call `get_source` for the full record, or `search_regulation` for the corpus content under a document.

---

## `get_source`

Fetch a source document record by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `SourceId` | e.g. `source://eba/gl-2017-16` |

**Returns:** `Source` — unknown ids are an `isError` result pointing at `list_sources`.

```ts
type Source = {
  id: SourceId;
  title: string;
  framework: string;               // matches Regulation.framework
  document_id: string;             // joins to Regulation.document_id
  doc_type: "regulation" | "guideline" | "guide" | "consultation" | "statement" | "report" | "other";
  status: "current" | "pending" | "superseded";
  published?: string;
  effective_from?: string;
  verified: string;                // last date currency was confirmed against the publisher
  superseded_by?: SourceId;        // set iff status is "superseded"
  milestones: { date: string; event: string }[];   // chronological; dates are display strings, never parsed
  url?: string;
  notes?: string;
  coverage?: "full" | "partial";   // absent = not declared, never defaulted
  pending_changes?: Array<PendingChange & {         // absent = the registry never looked; [] = it looked and found none
    state: "ingested" | "upcoming" | "in_force_not_ingested" | "undated";   // computed on every call, never stored
  }>;
}

type PendingChange = {
  title: string;
  reference?: string;              // the amending instrument's own reference, when the title omits it
  status: "announced" | "adopted"; // announced = proposed or expected; adopted = decided or published
  effective_from?: string;         // ISO date, parsed; absent = no application date recorded
  ingested: boolean;               // does the text this corpus serves already reflect the change?
  affects?: string[];              // provisions concerned: free text for a reader, never parsed or matched
  note?: string;
  url?: string;
}
```

**On `pending_changes`:** the registry's statement of what is coming (or has come) to the document and whether the corpus has caught up. `get_source` serves each entry with its `state` computed against today's date — `upcoming` (not ingested, applies after today), `in_force_not_ingested` (not ingested, applies today or earlier: the corpus's text for the document may be out of date), `undated` (not ingested, no application date) or `ingested` (the quiet state) — so a caller does not do the date arithmetic. Only a **current** source speaks for a document's records: `pending_changes_note` and `get_corpus_info.pending_changes` take its entries and no others, since a superseded or pending source describes another edition of the document. The registry views (`list_sources`, `get_source`) show what each entry records, whatever its status. The same changes reach the records themselves as [`pending_changes_note`](./regulation#get-regulation) and are listed corpus-wide by [`get_corpus_info`](./meta#get-corpus-info). See [Corpus structure → Declaring pending changes](../corpus/#declaring-pending-changes).

**On `document_id`:**

The join to the content surfaces. A source and the regulation records derived from it share a `document_id` — there is no URI reference in either direction, so a source can exist before any content does (a pending consultation is exactly that). Sources never appear in `Regulation.children` or `get_referrers`.

**Example:**
```ts
get_source("source://eba/cp-2016-21")
→ {
    title: "EBA-CP-2016-21 Consultation on PD/LGD estimation guidelines",
    doc_type: "consultation",
    status: "superseded",
    superseded_by: "source://eba/gl-2017-16",
    verified: "2026-07-12",
    notes: "Consultation that produced EBA-GL-2017-16; kept for provenance."
  }
```

### Source URI format

Sources use a two-segment URI: `source://{framework}/{document-id}`

Examples:
- `source://eba/gl-2017-16`
- `source://crr/575-2013`
- `source://ecb/guide-internal-models`

Sources are latest-only: supersession is `status: "superseded"` plus a `superseded_by` pointer to the successor record, never version history (versioning lives on `Regulation` alone). Keeping the registry current is a maintenance-session job — `/maintain-context`, gated by `bun run validate` — so the server stays read-only.
