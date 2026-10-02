# Meta tools

Nine cross-cutting tools that operate across all five surfaces. Defined in `src/tools/meta.ts`.

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
    source: number;
  };
  coverage: string[];         // e.g. ["CRR", "EBA-GL-2017-16"] — names documents, NOT how much of each
  holdings?: Array<{          // per document: what is actually held — computed at serve time, never stored
    document_id: string;
    framework: string;
    title?: string;           // from the matching source, when there is one
    records: number;          // regulation records held
    partial?: boolean;        // true: source declares partly held · false: declares full · key ABSENT: undeclared
  }>;
  stale_sources: SourceId[];  // current sources whose verified date is >30 days old — computed, never stored
}
```

**Example:**
```ts
get_corpus_info()
→ { last_updated: "2024-10-01T00:00:00Z", counts: { regulation: 12, test: 3, check: 4, playbook: 2, source: 5 }, coverage: ["CRR", "EBA-GL-2017-16"],
    holdings: [{ document_id: "crr", framework: "crr", title: "Regulation (EU) No 575/2013 (CRR)", records: 4, partial: true },
               { document_id: "eba-gl-2017-16", framework: "eba", title: "…", records: 2, partial: false }],
    stale_sources: ["source://eba/gl-2017-16"] }
```

**`coverage` names documents; `holdings` says how much of each.** A corpus holds a subset of the articles of a regulation, and `"CRR"` in a list reads as the whole of it. `partial` is what the source registry *declares* about the document (see [Corpus structure → Declaring coverage](../corpus/#declaring-coverage)): `true` means the document is held in part, so a provision missing from the corpus is not necessarily missing from the law; `false` means the registry declares it held in full; **an absent `partial` key means nothing was declared** — it is not "full". Only a current source speaks for a document, and where a document's current sources disagree, partial wins. `holdings` is computed from the records and the registry each time, even when the corpus file ships a stored `corpus_info` block, and `coverage` is left exactly as authored. An adapter that predates the field omits it.

A non-empty `stale_sources` means the registry needs a maintenance run — follow up with `list_sources`.

---

## `get_referrers`

Find everything in the corpus that references a given ID. Works on any content surface — regulation, test, check, or playbook. (Sources sit outside the reference graph; they join via `document_id` instead.)

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

The scan covers every typed reference: `parent`/`children` (regulation), `derived_from`/`parent` (checks), `regulatory_basis`/`parent` (tests), and `regulatory_scope` **plus every phase's `references`** (playbooks). A `source://` id is an `isError` explaining that sources join via `document_id`, not by URI.

**Example:**
```ts
get_referrers("regulation://crr/180/1/a")
→ {
    regulation: ["regulation://crr/180"],                    // the parent article lists it in children
    tests:      ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"],  // regulatory_basis
    checks:     ["check://calibration/pd/lra-derived"],      // derived_from + parent
    playbooks:  ["playbook://calibration/pd"]                // a phase reference
  }
```

---

## `resolve_citation`

Loose, human-prose citation string → the Regulation record it names, **or an honest refusal**. Matching is exact and there is no fuzzy fallback, because a confident wrong citation is the worst thing this server can produce — the consumer prints it as a citation.

Passes, in order, and nothing below them:

1. **Exact citation equality** — lowercased, punctuation stripped, abbreviations expanded (`art` → `article`, `para` → `paragraph`, `gl` → `guidelines`), with the document's own name removed from both sides so `Art. 180` matches a record whose citation reads `CRR Article 180`. A label the record declares in `citation_aliases` is matched the same way, at `confidence: "alias"`. This pass is first on purpose: a record's own citation is the strongest evidence a citation can have, so no gate below may refuse a citation that is exactly a record's — even one whose citation happens to contain a word the gate reads (`RTS Article 5`, `Regulation (EU) 2022/439, Article 14`).
2. **Instrument gate.** A citation naming an instrument the corpus does not hold (`CRR`, `CRD`, `Regulation (EU) No 9999/9999`) resolves to `match: null` with a `coverage_note`, rather than into another document that happens to share a number. A wrong instrument is not a near miss; it is a different body of law.
   The gate also reads an instrument named by **description**: `RTS` (in any case, plural or dotted: `rts`, `RTSs`, `R.T.S.`), `ITS` (in upper case, plural or dotted: `its` is a pronoun, so the lower-case word counts only straight after a determiner, as in "the its on reporting"), *regulatory/implementing technical standards*, a bare *technical standards* (it names one of the two, so a held RTS or ITS releases it), *(Commission) delegated/implementing regulation, decision or act*, *ECB (or European Central Bank) regulation/guideline/decision/recommendation*, *guideline of the ECB*. Words may be separated by any run of white space or dashes (`regulatory-technical-standards`), because a gate that reads one spelling is walked round by the next. When the corpus holds no document identified as that kind (an `rts`, `its`, `delegated`, `implementing` or ECB-kind token in a held document's id segment, document id or framework), the citation resolves to `match: null` with **no candidates**, and the note quotes the description, says nothing was matched, and points to citing the instrument by number, `search_regulation` with its name, and `get_corpus_info`. It states nothing about what the instrument requires. A descriptor that is followed by the act's number is left to the number gate. If the citation names a held document **and** an unheld described instrument, the note names both and asks for one instrument per citation. A corpus that does hold a document of that kind resolves normally. `Guideline (EU) YYYY/NNN` is recognised as a numbered instrument alongside regulations, directives and decisions.
3. **Exact numeric-spine equality**, scoped to the document the citation names. The spine is the article/paragraph/point numbers with structural words dropped, so `Chapter 5, paragraph 12`, `chapter 5 para 12` and `5.12` all compare equal — while `1218` is still not `121`, and `178` is not `178(1)(a)`. The document's own numbers are stripped first: `EBA GL 2017/16 paragraph 78` looks for provision 78, not for one numbered 2017.
4. **Narrower relatives.** If the corpus holds provisions *under* the citation but not the node itself, they come back as `candidates` with `match` still `null` — "the corpus holds 178(1)(a) and 178(1)(b), but no Article 178" is useful; "Article 178 is 178(1)(a)" is false.

5. **Containing provision** — the mirror of 4. The corpus stores some documents at whole-article granularity, so `Article 181(1)(b)` has no record of its own but sits inside `Article 181`. The container comes back as the (narrowest) `candidate`, `unmatched_segments` lists the numbers that could not be placed, and `match` stays `null` with `confidence: "none"` — containment is reported, never matched. Two guards keep it safe: a record whose citation has no faithful numeric spine never contains anything, and numbers are compared as whole tokens, so `1218` is not inside `121`.
   The note does not assume the container carries the point: the container's text is read for it first (`textCarriesPoint`), each deeper segment looked for only inside the span of the one before it — point `(b)` must follow paragraph 2's marker and precede paragraph 3's. Markers are read as `1.`, `(1)` or `1)` for numbers and `(a)` or `a)` for letters, only where a list item can start (at a line head, or after `;` `:` `.`), and only as a run: `9.` is a paragraph only after `1.` to `8.`. The verdict decides the wording. **yes** (every marker found in place): "whose text carries point …". **no** (the text numbers items that way and the marker is not there): "no point … was found in its text; its numbering may differ. Open it and check before anything is cited from this resolution." **unknown** (no markers at all, another numbering style, an irregular run, an inserted `1a`, roman sub-points): "whether its text has point … could not be established". Only a verified `yes` says the text carries the point; a `no` is a statement about markers found, not about the law.

The `match` record is served undecorated: it does not carry `pre_adoption_placeholders`, so a resolved record whose text names an instrument by a placeholder number (Regulation (EU) xx/xx) is not flagged here. Fetch it with `get_regulation` for the flag.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `text` | `string` | A loose citation in ordinary prose |

**Returns:** `{ match, confidence, candidates, ambiguous, unmatched_segments, coverage_note }`

When the declined citation names a document the registry declares partly held — or names no document and some held document is partial, in which case the note names which — `coverage_note` adds that the corpus holds only part of the document, so the provision is absent from the corpus and not necessarily from the law. This is explanation only: `match` stays `null` and `confidence` stays `"none"`. The clause rides on the "nothing is numbered …" note and on the narrower-relatives note; the containing-provision note does not carry it, because there the provision's text *is* held (whether it carries the cited point is a separate question, answered by the check above). A document declared full, or not declared at all, adds nothing.

| Field | Meaning |
|---|---|
| `match` | The record, or `null`. **A null match is not a citation** — never present one as though the text were found. |
| `confidence` | `"exact"` \| `"segment"` \| `"none"` — which pass matched |
| `candidates` | `{ id, citation, document_id }` for every equally good match, or for the narrower relatives of a node the corpus lacks. Non-empty ⇒ `match` is `null`. |
| `ambiguous` | `true` when several records fit and choosing one would have been a guess |
| `unmatched_segments` | Citation numbers the resolver could not place — a dropped `(1)(a)` shows here instead of being ignored |
| `coverage_note` | Why nothing was returned, in terms of what this corpus covers |

**Example** (against a corpus holding CRR and EBA GL 2017/16):
```ts
resolve_citation("Art. 178(1)(a)")
→ { match: <regulation://crr/178/1/a>, confidence: "exact", candidates: [], ambiguous: false }

// No crr/178 record exists. The relatives are reported; the match is not guessed.
resolve_citation("CRR Article 178")
→ { match: null, confidence: "none",
    candidates: [<…/178/1/a>, <…/178/1/b>],
    coverage_note: "No record is \"CRR Article 178\" itself. The corpus holds 2 narrower provisions under it…" }

// The same number in two documents: reported, not resolved.
resolve_citation("Article 78")
→ { match: null, ambiguous: true, candidates: [<gl-2017-16/…>, <gl-2019-03/…>],
    coverage_note: "\"Article 78\" matches 2 records across 2 document(s). Name the document to disambiguate…" }

// An instrument named by description, which this corpus holds no document identified as:
// no match, no candidates (even though held guidelines carry a paragraph 49).
resolve_citation("Article 49(3) of the RTS on the IRB assessment methodology")
→ { match: null, confidence: "none", candidates: [],
    coverage_note: "\"Article 49(3) of the RTS on …\" names an instrument by description (\"RTS on the IRB
                    assessment methodology\"), and this corpus holds no document identified as such. Nothing was
                    matched, rather than sourcing a same-numbered provision from another document. Cite the
                    instrument by number…" }
// The same decline for a descriptor with a number the number gate cannot read
// ("the Delegated Regulation 2022/439", no "(EU)"), and for an identifier such as
// "EBA/RTS/2016/03" (worded as an identifier). With "(EU)" the number gate owns it.

// An instrument this corpus does not hold.
resolve_citation("Article 1 of Regulation (EU) No 9999/9999")
→ { match: null, candidates: [],
    coverage_note: "This corpus holds no Regulation (EU) No 9999/9999. Nothing was matched, rather than
                    sourcing a same-numbered provision from another document…" }
```

```ts
// CRR is declared partial in the registry (the seeded demo holds 4 of its records).
resolve_citation("Article 99 CRR")
→ { match: null, confidence: "none", unmatched_segments: ["99"],
    coverage_note: "Nothing in this corpus is numbered 99 in the document named. This corpus holds only part of
                    Regulation (EU) No 575/2013 (CRR) (4 records), so a provision missing here is absent from
                    the corpus, not necessarily from the law. Try search_regulation…" }
```

On any `null`, fall back to `search_regulation` with the citation's key words, or `get_corpus_info` for the documents actually loaded.

---

## `list_review_areas`

The taxonomy of review areas. **Start here** to map a real-world analyst task onto the corpus's structure, then feed an area id to [`get_area_overview`](#get_area_overview).

A backend that authors an explicit `taxonomy` has it served verbatim — an authored taxonomy can name areas the corpus does not cover yet, which a derived one cannot. A backend that authors none gets one **derived from the playbooks present**: each distinct `area` becomes a top-level node and each `subarea` a child, keyed by [`src/areas.ts`](https://github.com/rhozacc/prudent-mcp/blob/main/src/areas.ts). So this is never empty for a corpus that has playbooks.

**Inputs:** none

**Returns:** `{ areas: ReviewArea[] }`

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
→ { areas: [
    { id: "calibration",     name: "Calibration",     children: ["calibration.pd", "calibration.lgd"] },
    { id: "calibration.pd",  name: "PD Calibration",  parent: "calibration", children: [] },
    ...
  ]}
```

---

## `expand_playbook`

Fetch a playbook with all `Phase.references` resolved inline. Avoids N+1 fetches when an LLM needs to reason about all phases at once.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `PlaybookId` | e.g. `playbook://calibration/pd` |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `ExpandedPlaybook` — unknown ids are an `isError` result pointing at `search_playbooks`.

By default each reference in `phases[*].references` becomes a `{ type, id, label }` stub (label = citation for regulation, name for tests/checks, area/subarea for playbooks; `null` when unresolved). With `detail: "full"` each becomes `{ type, id, record }` with the complete Regulation / Test / Check / Playbook object embedded.

**Example:**
```ts
expand_playbook("playbook://calibration/pd")
→ {
    id: "playbook://calibration/pd",
    phases: [
      {
        name: "Validate LRA derivation",
        references: [
          { type: "regulation", id: "regulation://crr/180/1/a", label: "CRR Article 180(1)(a)" },
          { type: "check",      id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
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
| `area` | `string` | Area slug (`"pd-estimation"`, `"calibration.pd"`) **or** the area name as spelled on a playbook record (`"PD Estimation"`) — call `list_review_areas` for the canonical list |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` — walkthrough summary vs. embedded records. `"full"` falls back to the summary (with a `notice`) when it exceeds the per-response ceiling |

**Returns:** `AreaOverview` — unknown areas are an `isError` result pointing at `list_review_areas`.

Asking for a top-level area includes everything in its subareas, so
`get_area_overview("credit-risk")` covers the playbooks filed under
`credit-risk.irb-approach-governance-…` too.

```ts
type AreaOverview = {
  area: ReviewArea;
  playbooks: PlaybookWalkthrough[]; // phases + reference_counts; detail: "full" embeds records
  regulation_ids: RegulationId[];   // deduplicated across all phases
  check_ids: CheckId[];
  test_ids: TestId[];
  playbook_ids: PlaybookId[];       // other playbooks referenced, minus the ones above
}
```

By default a phase carries `reference_counts` rather than the reference stubs
themselves. Every stub was also an entry in the flat id lists above it, at
roughly twice the bytes — on a real area that duplication was 73% of the whole
payload, the response spending a fifth of a working context restating what it
had already said. Nothing became unreachable: the ids are in the flat lists, and
[`expand_playbook`](#expand_playbook) resolves them per phase when the phase a
reference belongs to is what matters.

`playbook_ids` matters because some playbooks are indexes over others: a
lifecycle playbook's phases reference the per-parameter playbooks and nothing
else, so an overview gathering only regulation/check/test ids would answer
"1 playbook, 0 of everything".

**Example:**
```ts
get_area_overview("calibration.pd")
→ {
    area: { id: "calibration.pd", name: "PD Calibration", ... },
    playbooks: [{ id: "playbook://calibration/pd", area: "PD Calibration",
                  phases: [{ name: "Scope the calibration sample", description: "…",
                             reference_counts: { regulation: 4, check: 2, test: 3, playbook: 0 } }],
                  gates: ["…"], last_updated: "2026-08-20" }],
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
| `as_of` | `string` (ISO date) | Optional — resolve the regulation as of this date (same rule as `get_regulation`, including the `as_of_note`) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `ExpandedRegulation` — unknown ids are an `isError` result pointing at `search_regulation`.

```ts
type ExpandedRegulation = {
  id: RegulationId;
  citation: string;
  framework: string;
  document_version: string;
  text: string;
  parent: RegulationId | null;
  children: { type, id, label }[];   // stubs by default; detail: "full" embeds the complete records
  as_of_note?: string;               // only with as_of, when the current text was served because no version is recorded for that date
  pre_adoption_placeholders?: string[]; // only when the record's own text names an instrument by a placeholder number
  notice?: string;                   // with pre_adoption_placeholders: the placeholder is not a citation
}
```

`pre_adoption_placeholders` and `notice` are the same flag [`get_regulation`](./regulation#get-regulation) attaches (one scan, `src/placeholders.ts`), computed over the record asked for and not over the children it embeds.

With `as_of`, regulation children are resolved under the same date as the record, so a child with a recorded version for that date is embedded at that version (the same one [`get_regulation`](./regulation#get-regulation) serves), not at its latest. The note is the one `get_regulation` attaches, and it also counts any children served from current text because the corpus records no version of them for the date, so a record covered by history still carries a note when one of its children is not. A child the corpus lists but has no version of for the date (its recorded history starts later, or its document was published later) is listed by id with a null label or record; the note counts those too, apart from the others, and says that this is a gap in the corpus's history and not a statement about the law. An id the corpus does not hold at all is a dangling reference and is not counted. Checks and tests are not versioned and are resolved as always.

**Example:**
```ts
expand_regulation("regulation://crr/180/1/a")
→ {
    id: "regulation://crr/180/1/a",
    citation: "CRR Article 180(1)(a)",
    children: [
      { type: "check", id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
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
| `as_of` | `string` (ISO date) | Optional — resolve regulations as of this date; an `as_of_note` on the root says when nodes were served from current text, and counts nodes the corpus has no version of for the date (shown by id only, the walk does not continue below them) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `RegulationTreeNode` — unknown roots are an `isError` result pointing at `search_regulation`.

Regulation children recurse; checks/tests are resolved leaves. The walk is bounded three ways — `depth`, a cycle guard, and a hard cap of **200 total nodes** — and any node cut off by a bound is flagged `truncated: true`. Concise (default) keeps `{ type, id, citation }` per regulation node and `{ type, id, label }` per leaf; `detail: "full"` embeds each node's complete record.

```ts
type RegulationTreeNode = {
  type: "regulation";
  id: RegulationId;
  citation: string;
  record?: Regulation | null;        // detail: "full" only
  children: (RegulationTreeNode | { type: "test" | "check"; id; label })[];
  truncated?: boolean;
  as_of_note?: string;               // root envelope only, with as_of — see below
}
```

**`as_of_note`.** Each regulation node resolves as of the date on its own. Where no version is recorded for a node's date, its current text is served — and the root envelope carries one `as_of_note` saying so. If the root itself was served that way the note is the same as `get_regulation`'s, followed by a count of the other nodes treated the same; if only other nodes were, it says how many. There is no per-node field: a walk can reach 200 nodes and the same sentence 200 times is the cost the note exists to avoid. `detail: "full"` shows each node's `document_version`. No note without `as_of`, or when every node came from a recorded version.

**Example:**
```ts
get_regulation_tree("regulation://crr/180")
→ {
    type: "regulation", id: "regulation://crr/180", citation: "CRR Article 180",
    children: [
      { type: "regulation", id: "regulation://crr/180/1/a", citation: "CRR Article 180(1)(a)", children: [
        { type: "check", id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
      ]},
      { type: "check", id: "check://calibration/pd/segment-tested", label: "PD calibration tested per grade or pool" }
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
