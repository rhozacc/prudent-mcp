# FAQ

Boundary questions, common gotchas, and things that come up in conversation often enough to be worth writing down.

## Scope

### Why isn't this a write API?

The MCP is the read-only knowledge layer. Mutating the corpus belongs upstream — in the editorial process that produces the corpus, not in the runtime that serves it. Mixing them blurs the source of truth: if a tool can both serve `regulation://crr/178/1/a` and edit it, every consumer has to ask "which version am I getting?"

Keeping it read-only means the corpus has exactly one ingest path, and every consumer (LLM clients, audit tooling, downstream services) sees a consistent view.

### Why doesn't it execute statistical tests?

Two reasons.

First, the boundary. Test execution requires portfolio data — bank-confidential, often hundreds of MB to GB, governed by separate access controls. Putting it behind the same MCP surface as the regulatory text would force every reader of regulation to be authorised for the data. That's not the right factoring.

Second, the contract. The MCP describes a test (`what it measures, what acceptance bar applies, what regulation backs it`). Running it is a different concern with different reliability requirements. The runtime that runs Hosmer-Lemeshow on a million-row portfolio doesn't belong in a knowledge-serving process.

`prudent-runtime` is the planned execution layer. It lives outside this repo.

### Why aren't there more prompt scaffolds?

The three existing prompts (`validate_review_area`, `review_calibration`, `assess_findings`) cover the common entry points. More prompts means more surface to maintain, and the marginal one is usually a thin variant of an existing one. The model is capable enough to recombine — a prompt that says "walk the LGD calibration playbook" doesn't need its own scaffold.

If you find yourself wanting a fourth, write it in the host (Claude Desktop / Code projects can carry their own prompts) before adding it to the corpus.

## Implementation

### Can I extend the schema?

You can add a surface or a field, but every change has implications for the typed cross-references. If you add a new surface `evidence://`, you need to decide:

- Can a `Phase` reference an `Evidence` ID? If so, widen `Phase.references` to include `EvidenceId`.
- Can a `Check.expected_evidence` reference an `Evidence` ID? Probably yes, with a typed array.
- Does it need a reverse index in `Referrers`? Yes — if other surfaces reference it by ID.

The sources surface is the counter-example: it deliberately stays outside the reference graph. No field on any content surface points at a source, `superseded_by` never leaves the registry, and the join to regulation is a computed `framework` + `document_id` string match. Follow that pattern when the new surface is a registry rather than referenced content.

The right path is: prototype on a fork, get the type errors to settle, run the in-memory demo against the new shape, then propose.

Don't widen typed IDs to `string` to make changes easier. That defeats the compile-time URI segregation that the schema is built around.

### Can I add a backend without forking?

Yes — that's what the `adapters` object is for. Reassign its handles at startup:

```ts
import { adapters } from "prudent-mcp/adapters";
import { createServer } from "prudent-mcp";

adapters.regulation = new MyBackendRegulationAdapter(/* ... */);
adapters.test       = new MyBackendTestAdapter(/* ... */);
// ...

const server = createServer();
```

The server picks up whatever you assigned. The in-memory demo is the canonical template — see [adapters](/adapters/).

### Why `regulation://crr/178/1/a` and not `regulation://crr/178.1.a`?

Path segments map naturally to the regulatory structure: framework → article → paragraph → point. Each is its own segment, and the URI can be truncated meaningfully (`regulation://crr/178` is the whole article, `regulation://crr/178/1` is paragraph 1, etc.). Dotted slugs flatten this and make the hierarchy opaque to anyone reading the URI.

### Why hierarchical Check URIs (`check://area/topic/specific`)?

Same reason. `check://calibration/pd/lra-derived` makes the area and topic visible at a glance and aligns with `playbook://calibration/pd`. A flat slug like `check://lra-derived` makes the area implicit, which doesn't scale once you have 200 checks across 20 areas.

## Operations

### How is regulation versioning surfaced to the client?

`get_regulation(id, as_of?)`. With no `as_of`, you get the latest version. With `as_of: "2018-01-01"`, you get the version in force on that date.

Internally, the adapter is expected to hold the full version history per `RegulationId`. The MCP picks the right one and returns its `document_version` field on the response.

Where the corpus records no version of a provision for the date you asked about, it serves the current text rather than nothing — and the response carries an `as_of_note` saying that this is the version named in `document_version`, that it may differ from the text in force on that date, and that it must not be presented as the historical text. `expand_regulation` and `get_regulation_tree` carry the same note. A date before the source document existed is a miss.

### Is the text I am reading about to change — or already out of date?

A corpus is a snapshot, so the source registry says what the snapshot is behind on. Where it records a change to a document that this corpus has not ingested, `get_regulation`, `expand_regulation`, `get_regulation_tree` (on the root) and a `resolve_citation` match carry a `pending_changes_note`: which change, when it applies (and how many days away), and that the text served is the version before it — or, once the date has passed, that it "may no longer be the text in force". `search_regulation` adds one sentence to `notice` for a page that includes such a document, and `get_corpus_info.pending_changes` lists every open change. The note says nothing about what the change provides; the corpus does not hold it. Under an `as_of` earlier than the change, it is left out (the text of that date is not behind it).

**No note is not "nothing is coming".** It means the registry records no open change for the document, or nobody has declared the field; `get_source` shows which (`pending_changes: []` is "looked, none found", `verified` says when; a missing key is "never looked"). See [Declaring pending changes](../corpus/#declaring-pending-changes).

### A passage cites "Regulation (EU) xx/xx". Is that a regulation?

No. A guideline written before a technical standard was adopted names it with a placeholder number. `get_regulation` and `expand_regulation` flag such a record with `pre_adoption_placeholders` (the spans) and a `notice`: the placeholder is not a citation, the instrument may be identified elsewhere in the corpus or not at all, and the passage is not the current state of the law. The flag is computed from the text; search rows and `resolve_citation` matches do not carry it.

### A lookup missed. Does that article not exist?

Not necessarily. The corpus holds the provisions it was built from, which for some documents is a subset of the articles. `get_corpus_info.holdings` says, per document, how many records are held and whether the source registry declares the document partly held (`partial: true`), whole (`false`) or says nothing (key absent). A miss on `get_regulation`, `expand_regulation` or `get_regulation_tree`, and a `resolve_citation` decline, repeat that in plain words: on a partly held document the provision is absent from the corpus, not necessarily from the law. See [Declaring coverage](../corpus/#declaring-coverage).

### Does the corpus distinguish CRR vs CRR2 vs CRR3?

No — `regulation://crr/178/1/b` is a stable ID. The `document_version` field tracks which textual revision is in force. So the 2013, 2019, and 2024 versions of CRR Article 178(1)(b) all share the same ID and differ only in `document_version` and `text`.

This keeps URIs stable across regulatory revisions. Citing `regulation://crr/178/1/b` in a check or finding is always meaningful, regardless of which CRR vintage was in force when the model was built.

### What about transposition into national law?

The corpus models the EU-level instrument (CRR, EBA GL). National transpositions and supervisor-specific interpretations live in `commentary` entries on the relevant paragraph, attributed to their source (e.g., `"BaFin RV 4/2020"`). The base regulation text is the EU text.

If you need first-class national framework records, add a new framework — `regulation://bafin/rv-4-2020/...` — without changing the schema. The framework slug is free-form.
