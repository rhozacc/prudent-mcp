# Regulation tools

Two tools for the regulation surface. Defined in `src/tools/regulation.ts`.

Regulation is the only versioned surface — records carry a `document_version`, and `get_regulation` accepts `as_of` for historical lookups.

---

## `search_regulation`

Ranked, field-scoped search across all loaded regulatory frameworks: citation (weight 3), text (2), commentary (1). Record ids join the field set only when the query itself looks URI-like — a prose query never matches through the `regulation://` scheme.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Minimum 2 characters — search never enumerates the corpus |
| `limit` | `number` | Optional page size, default 20, max 100 |
| `offset` | `number` | Optional — skip this many ranked matches |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** the shared envelope `{ results, returned, total_matches, offset, truncated, next_offset, query_tokens, best_coverage, notice }` — latest versions only. Concise results are `{ id, citation, matched_excerpt, document_id, parent }`, where `matched_excerpt` is a run of whole sentences around the best match — quotable as it stands, so a hit can be answered from without re-fetching the record. `detail: "full"` serves complete records with `commentary` capped per row and `commentary_omitted` declaring what was withheld; `get_regulation` serves every entry. Concise rows also carry `coverage` — how many of the query's `query_tokens` meaningful terms that row matched; `best_coverage` is the highest of any row across the whole ranked set (page 2 still reports it), and `notice` says so when the best match covers fewer than half the terms. `detail: "full"` records are not decorated; the envelope fields still appear.

**Example:**
```ts
search_regulation("long-run average")
→ {
    results: [
      { id: "regulation://crr/180/1/a",       citation: "CRR Article 180(1)(a)", matched_excerpt: "…from long-run averages of one-year default rates…", ... },
      { id: "regulation://eba/gl-2017-16/78", citation: "EBA GL 2017/16 paragraph 78", ... }
    ],
    total_matches: 2, offset: 0, truncated: false
  }
```

Use `get_referrers` on any returned id to find the checks and playbooks that operationalise it. Use `get_regulation` with `as_of` for historical versions.

---

## `get_regulation`

Fetch a regulation paragraph by URI.

**Inputs:**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `id` | `RegulationId` | yes | e.g. `regulation://crr/178/1/a` |
| `as_of` | `string` (ISO date) | no | Returns the version in force on this date; carries an `as_of_note` when the corpus records no version for it (below) |

**Returns:** `Regulation` — unknown ids are an `isError` result pointing at `search_regulation`. Two additive keys, `pre_adoption_placeholders` and `notice`, appear only when the text names an instrument by a placeholder number (below).

**Misses say what kind of absence they are.** "No record for X" is true and reads as "there is no X", but a corpus holds some provisions of a document, not all of them. The same sentence is used by `get_regulation`, `expand_regulation` and `get_regulation_tree` (one helper, `unknownRegulationMiss`), and it works out the document from the id's first path segment against the documents held (`holdings`, see [`get_corpus_info`](./meta#get-corpus-info)):

| The id's document | The miss adds |
|---|---|
| declared partial | the corpus holds only part of it (n records); a provision missing here is absent from the corpus, not necessarily from the law |
| held, coverage undeclared | the corpus holds n records of it and does not declare that as the whole, so absence here does not show the provision does not exist |
| declared full | the document is declared held in full, so the id is probably mistyped |
| not held | no document with that id prefix is loaded; `get_corpus_info` lists what is |

The `search_regulation` / `list_review_areas` pointer follows in every case, and the result is still `isError`.

The `as_of` rule (see [Corpus structure → Versioning](../corpus/#versioning)): with no history for the id, the backend serves the only version it knows — the current one — **and says so**; with history, the version in force on the date is returned, and an `as_of` predating every recorded version is a miss explaining the rule — never current text masquerading as historical. A date before the source document existed is also a miss.

**`as_of_note`.** When `as_of` is given and the text served is the current record because the corpus records no version of the provision for that date, the response carries an additive string key `as_of_note` ahead of the record fields:

```ts
get_regulation("regulation://crr/180/1/a", as_of: "2024-12-31")   // an id with no recorded history
→ {
    as_of_note: "This corpus records no version of this provision for the requested as_of date (2024-12-31). The text served is the version named in document_version (2024-01-09), which may differ from the text in force on that date. Do not present it as the historical text.",
    id: "regulation://crr/180/1/a", document_version: "2024-01-09", text: "...", ...
  }
```

The record is still the best text the corpus has, so it is served and not turned into a miss — but it must not be cited as the text of that date. The key is **absent** (never present and empty) when `as_of` is not given, when a recorded version covers the date, and on a miss. It is declared optional in the tool's published output schema, which stays open. `expand_regulation` carries the same note next to its record fields, and counts any regulation children that were also served from current text, and any the corpus holds but has no version of for the date (listed by id only); `get_regulation_tree` puts one note on the root envelope and counts any other nodes in the same two situations rather than stamping each node. A miss says in its message that a date the corpus has no version for is otherwise answered with the current text and a note.

**`pre_adoption_placeholders` and `notice`.** A guideline written before a technical standard was adopted cannot cite it, so it writes "Regulation (EU) xx/xx [RTS on …]". Served as it stands that reads as a citation, but there is no such regulation to look up. When the record's text contains such a reference, the response carries two additive keys ahead of the record fields:

```ts
get_regulation("regulation://acme-gl/paragraph-22")   // a synthetic id
→ {
    pre_adoption_placeholders: ["Regulation (EU) xx/xx [RTS on a topic]"],
    notice: "This text refers to an instrument by a pre-adoption placeholder; the placeholder is not a citation. The instrument may be identified elsewhere in the corpus or not at all. Do not present it as the current state of the law.",
    id: "regulation://acme-gl/paragraph-22", text: "...", ...
  }
```

`pre_adoption_placeholders` lists the matched spans as they appear in the text (distinct, at most 3, each at most 120 characters; when the text holds more, the notice says how many). The flag is **computed from the served text** by one scan (`src/placeholders.ts`), never authored, so it needs no re-extraction and applies to every corpus. The scan wants an instrument word ("Regulation", "Directive", "Decision", "Guideline"), an optional "(EU)" and "No", and an act number in which at least one half is a stand-in — `xx`, `XXXX`, `20xx`, `201x`, `[...]`, `[…]`. A numbered act (`2021/930`, `575/2013`) never triggers it, and neither does a bare `xx` or an elision in a quotation: a false flag would call a real citation not-a-citation. A guideline's placeholder for its *own* reference number is not an act number and is not flagged. The keys are **absent** (never present and empty) on every other record, which is served byte for byte as before. If a record ever carried a `notice` of its own, the placeholder statement moves to `placeholder_notice` so neither overwrites the other. Both keys are declared optional in the tool's published output schema, which stays open.

Where it applies: `get_regulation` and `expand_regulation` flag the record asked for. They do not scan the children an expansion embeds, and `detail: 'full'` search rows do not carry the flag (they are the canonical record schema served unmodified; the flag is one `get_regulation` away). `resolve_citation` returns its `match` record undecorated, so a resolved record that names a placeholder is not flagged there — fetch it with `get_regulation` before relying on its text.

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
