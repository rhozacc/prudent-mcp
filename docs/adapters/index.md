# Adapters

The MCP server reaches its corpus through a small set of adapter interfaces defined in `src/adapters.ts`. In the open-source distribution the adapters are empty defaults — the server boots and answers MCP calls without crashing, it just has nothing to say. Pointing them at a corpus turns the lights on.

## The interfaces

```ts
interface RegulationAdapter {
  search(query: string): Promise<Regulation[]>;
  get(id: RegulationId, asOf?: string): Promise<Regulation | null>;
  /** Optional — see "Saying which basis an as_of record was served on" below. */
  resolveAsOf?(id: RegulationId, asOf: string): Promise<AsOfResolution>;
  list(): Promise<Regulation[]>;
}

type AsOfResolution =
  | { record: Regulation; basis: "history" | "current" }
  | { record: null };

interface TestAdapter {
  search(query: string): Promise<Test[]>;
  get(id: TestId): Promise<Test | null>;
  list(): Promise<Test[]>;
}

interface CheckAdapter {
  search(query: string): Promise<Check[]>;
  get(id: CheckId): Promise<Check | null>;
  list(): Promise<Check[]>;
}

interface PlaybookAdapter {
  search(query: string): Promise<Playbook[]>;
  get(id: PlaybookId): Promise<Playbook | null>;
  list(): Promise<Playbook[]>;
}

interface SourceAdapter {
  list(filter?: { status?: SourceStatus }): Promise<Source[]>;
  get(id: SourceId): Promise<Source | null>;
}

interface MetaAdapter {
  info(): Promise<CorpusInfo>;
  referrers(id: string): Promise<Referrers>;
  resolveCitation(text: string): Promise<Regulation | null>;
  taxonomy(): Promise<ReviewArea[]>;
}
```

## `list()` vs `search()`

Two different contracts on every content surface — do not conflate them:

- **`list()` returns ALL records.** It is the internal enumeration and traversal contract: the cross-cutting tools (`get_coverage_gaps`, `get_area_overview`), corpus scripts, validators, and resource completions call it when they genuinely need everything.
- **`search(query)` is ranked relevance search for a real query.** It never dumps the corpus: an empty or whitespace-only query returns `[]`. The old undocumented `search("")` → everything contract is gone — anything that leaned on it must call `list()` instead.

Search semantics are defined once, in `src/search.ts` (`rankedSearch` plus per-surface field sets), and shared by the file adapter and the in-memory demo. The contract:

- The query is tokenized (lowercased, split on non-alphanumerics). Only the declared fields are scanned, each with a weight — a query never matches JSON keys or URI scheme prefixes. For regulation, record ids join the field set (at low weight) only when the query itself looks URI-like, so a prose query like "regulation" no longer matches 100% of records.
- Score = weight × occurrences; whole-word occurrences count full weight, substring-only occurrences half. Results sort by score descending, ties by input order — fully deterministic.
- `rankedSearch` does not cap; the tool layer pages. Each match carries `{ record, score, coverage, query_tokens, matched: { field, excerpt } }`; the built-in adapters return the records, and every `search_*` tool re-ranks the returned records locally (with the same field set) to attach `matched_excerpt` and each row's `coverage`, and to report `query_tokens` and `best_coverage` on the envelope. An outside adapter therefore needs no new method: its records are measured by the server's own definition of coverage.

An external backend that wants ranking parity should call `rankedSearch` with the exported field sets rather than reinventing the scoring.

## Connecting a corpus

The `adapters` object is mutable. Reassign its handles at startup:

```ts
import { adapters } from "prudent-mcp/adapters";
import { HttpRegulationAdapter } from "./my-corpus.ts";

adapters.regulation = new HttpRegulationAdapter("https://corpus.example.com");
adapters.test   = new HttpTestAdapter(/* ... */);
adapters.check  = new HttpCheckAdapter(/* ... */);
adapters.playbook = new HttpPlaybookAdapter(/* ... */);
adapters.source = new HttpSourceAdapter(/* ... */);
adapters.meta   = new HttpMetaAdapter(/* ... */);

import { createServer } from "prudent-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createServer();
await server.connect(new StdioServerTransport());
```

## Built-in file adapter

`src/file-adapter.ts` ships with the server and loads a corpus from a JSON file. It is the adapter used by the MCPB distribution when `CORPUS_FILE` is set.

```ts
import { loadCorpusFile, createFileAdapters } from "prudent-mcp/file-adapter";
import { adapters } from "prudent-mcp/adapters";

const corpus = loadCorpusFile("/path/to/corpus.json");
const fa = createFileAdapters(corpus);
adapters.regulation = fa.regulation;
adapters.test       = fa.test;
adapters.check      = fa.check;
adapters.playbook   = fa.playbook;
adapters.source     = fa.source;
adapters.meta       = fa.meta;
```

The JSON is validated against the full zod schemas on load. `createFileAdapters` returns all six adapters backed by in-memory maps — `search` delegates to the shared `rankedSearch`, `get` is a direct map lookup, `list` returns the surface array. The optional `regulation_history` corpus key powers `get(id, asOf)` — see [Corpus structure → Versioning](../corpus/#versioning) for the file shape and the resolution rule. The MCPB entry point additionally runs the structural linter at startup: violations abort with exit 1, staleness warnings print to stderr without blocking.

## Saying which basis an `as_of` record was served on

`get(id, asOf)` returns a record, and a record cannot say whether it is the text in force on the date or only the best text the backend has: today's text served under a past date looks exactly like a historical version. A validator asking what applied at an approval date, and the model relaying the answer, would both take it for the text of that date.

`resolveAsOf(id, asOf)` is the optional method that closes this. It resolves exactly as `get(id, asOf)` does and also reports the **basis**:

| `basis` | Meaning |
|---|---|
| `"history"` | a recorded version covers the date — the text is the one then in force |
| `"current"` | no version is recorded for the date, so the current record was served as the best text available |

A miss is `{ record: null }`; it has no basis because nothing was served.

When the basis is `"current"`, `get_regulation`, `expand_regulation` and `get_regulation_tree` attach an additive `as_of_note` string saying that the corpus records no version for the requested date, which version was served (by its `document_version`), that it may differ from the text in force on that date, and that it must not be presented as the historical text. `expand_regulation` also resolves its regulation children through `resolveAsOf` under the same date (up to 0.8 it embedded their latest text whatever the date) and counts those served from current text. A child, or a `get_regulation_tree` node, that the corpus holds but has no version of for the date resolves to nothing and comes back as a bare id, which reads like a dangling reference; the note counts those separately and says so. There is no note without `as_of`, when history covers the date (for the record and its children), or on a miss.

The pre-adoption placeholder flag (`pre_adoption_placeholders` + `notice` on `get_regulation` and `expand_regulation`) needs nothing from an adapter: the tool layer computes it from the served `text` (`src/placeholders.ts`), so every adapter, including an out-of-tree one, gets it.

Rules for implementers:

- **Make it the one implementation and have `get` delegate to it.** The record must be exactly what `get(id, asOf)` returns; only `basis` is new. Two copies of the selection logic can disagree about what was served. `createFileAdapters` and the in-memory demo both do this.
- **The method is optional.** An adapter without it keeps compiling: the tools fall back to `get(id, asOf)`, and no substitution note is attached, because nothing says the text was substituted. Absent is not `"history"` — it is "unknown". A record `get(id, asOf)` cannot serve while `get(id)` can is still reported as having no version for the date.
- **Report `"current"` honestly.** An adapter that has no history but cannot tell the tool layer so serves a validator today's text under a past date with nothing to say it is not that date's text. Implement the method if your backend ever serves current text for a past `asOf`.

## Saying how much of a document is held

`MetaAdapter.info()` may return `holdings`: per document, how many regulation records are held and whether the registry declares the document `partial`. The tool layer's misses for an unknown regulation id compute the same thing from `regulation.list()` and `source.list()`, so an adapter does not need to publish `holdings` for its misses to be partial-aware.

- **Delegate to `computeHoldings(regulations, sources)` in `src/holdings.ts`.** It is the one definition (the file adapter and the in-memory demo both call it), including the conflict rule: only current sources speak for a document, and if their declarations differ, partial wins.
- **Never default `partial`.** The key is absent when no current source declares `coverage`; absent is not "full".
- **`resolveCitationDetailed(regulations, text, holdings?)`** takes the holdings as an optional third parameter. Without it the notes are exactly what they were; with it a decline on a partly held document says the absence is the corpus's, not necessarily the law's. `match` and `confidence` are unaffected — pass the holdings from your `MetaAdapter.resolveCitation`.

## Saying what the corpus has not ingested

A registry that knows an amendment is coming — or has come — and the corpus has not caught up, says so through `Source.pending_changes` (see [Corpus structure → Declaring pending changes](../corpus/#declaring-pending-changes)). The tool layer turns that into `pending_changes_note` on `get_regulation`, `expand_regulation`, `get_regulation_tree` (root) and a `resolve_citation` match, a sentence in a search page's `notice`, `get_corpus_info.pending_changes`, `open_pending_changes` on `list_sources` rows and a computed `state` on each change `get_source` serves.

It needs **nothing new from an adapter**: the tool layer reads `adapters.source.list()` and joins on `framework` + `document_id`, so a backend that serves sources gets the signal with no extra method, and a backend with no sources serves none (an empty registry has nothing to say). What a state means and the words that describe one live once, in `src/pending.ts` (`pendingState`, `openPendingChanges`, `openPendingFor`, `pendingChangesNote`, `pendingSearchNotice`, `pendingChangeSummaries`); the tool-layer helpers that attach it are in `src/tools/pending.ts`.

Rules for implementers:

- **Store `ingested` and `effective_from`; never store the state.** `upcoming`, `in_force_not_ingested` and `undated` are computed from the two and today's date on every call. A stored state is wrong the morning after the day. `pending_changes` on the source records is the only authored input.
- **Absent is not `[]`.** `pending_changes: []` says the registry looked and found nothing pending; a missing key says nothing. Do not default it. `MetaAdapter.info()` may return `pending_changes` (the open changes, computed by `pendingChangeSummaries(sources)`, which returns `undefined` until some source declares the field); `createFileAdapters` and the in-memory demo both call it, and the key is spread in only when defined.
- **Only current sources speak** for a document's records (`openPendingChanges` enforces it), as with `coverage`.
- **The tool layer calls `source.list()` once per record it serves** (and once per search page), because the registry is small and list-shaped. A backend where that is a network round trip should cache it for the length of a request.
- **Under `as_of`, a change that applies later is left out** of that request's note (`openPendingFor`). The demo's CRR source carries an open change applying in 60 days, so the note, its `as_of` omission and the corpus-wide list are all exercised.

## The in-memory demo as a template

`examples/inmemory-demo.ts` is the reference implementation for hand-coded adapters. It seeds a small slice of PD-calibration content into in-memory maps and implements all six adapter interfaces against them. Use it as the template when building your own backend.

Key things the demo shows:

- **`search(query)`** — delegates to `rankedSearch` with the surface's exported field set
- **`get(id, asOf?)`** — direct map lookup; `asOf` selects from per-id version history (the last entry whose `effectiveFrom` ≤ `asOf`; predating all entries → `null`; no history → current). It delegates to **`resolveAsOf`**, which reports `basis: "history" | "current"` so the tools can attach an `as_of_note`
- **`list()`** — returns every record on the surface; the sources variant filters by status
- **`resolveCitation(text)`** — delegates to `resolveCitationDetailed` from the file adapter, the deterministic citation matcher, passing `computeHoldings(...)` so a decline on a partly held document says so
- **`info()`** — serves `holdings` from the same `computeHoldings`; the seed's CRR source declares `coverage: "partial"` (the demo holds a handful of articles) and the EBA guideline `"full"`, so both kinds of miss are exercised. It also serves `pending_changes` from `pendingChangeSummaries`: the CRR source carries one open change (not ingested, applying in 60 days) and the EBA guideline `pending_changes: []` ("looked, none"), so the note, the quiet case and the absence rule are all exercised
- **`referrers(id)`** — delegates to `computeReferrers` from `src/referrers.ts`, the ONE reverse index over parent/children, `derived_from`, `regulatory_basis`, `regulatory_scope`, and playbook phase references

For a production adapter, replace the in-memory maps with HTTP calls, a database, or whatever backs the corpus. The interface contract is the same.

## Record validation

Records crossing the adapter boundary are validated at the handler level via zod. Invalid records are rejected before they reach the MCP response. The JSON Schemas under `docs/schemas/` are the portable, language-agnostic form of the same contract — use them to validate records in your adapter build pipeline:

```bash
bun run schemas   # regenerate docs/schemas/*.schema.json from src/schema.ts
```
