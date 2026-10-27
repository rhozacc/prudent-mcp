---
title: Tools
---

# Tools

Eight tools, one prompt and five resource templates. Everything is read-only. The standing cost of the whole surface is about 1.9k tokens (`bun run evals` prints the current figure).

The order a model follows, and the one the server's instructions give it:

1. **`brief`** with the question. It returns the compiled playbook that answers it, the provisions that matter but the playbook does not cite, neighbouring playbooks and notes.
2. **`playbook`** to open the whole playbook, or one requirement with the full text of its provisions.
3. **`search`**, **`get`**, **`cite`** to open particular provisions, **`related`** for their neighbours, **`sources`** for what the library covers and what is changing.

| Tool | Use it to | Inputs |
|---|---|---|
| [`brief`](#brief) | answer a substantive question | `question`, `as_of?`, `budget?` |
| [`playbook`](#playbook) | read a topic's playbook, or one requirement in full | `id`, `section?` |
| [`topics`](#topics) | list the areas and the playbook for each topic | none |
| [`search`](#search) | find passages for a specific wording | `query`, `scope?`, `document?`, `limit?`, `offset?`, `detail?` |
| [`get`](#get) | open entries by id, up to 20 | `ids`, `as_of?` |
| [`cite`](#cite) | resolve a citation written in prose | `text` |
| [`related`](#related) | see what surrounds an entry | `id`, `as_of?` |
| [`sources`](#sources) | say what the library holds and how current it is | `id?` |

Replies below are real output from the seeded demo (`bun run evals:call <tool> '<json>'` prints one; `bun run inspect:demo` opens the MCP Inspector on it). A real corpus is larger; the shapes are the same.

## Notes

A response that carries an edge-of-the-library fact carries it as a `notes` entry: `{ type, text, applies_to? }`. The text is written to be repeated to the user as it stands, in the library's own words (no tool names, no internal terms; see the language rule in [Architecture](/guide/architecture#the-language-rule)). `notes` is **absent, never empty**, when there is nothing to say: "no amendment recorded" is not "none is coming", so silence is not offered as reassurance.

| `type` | Means | Where it appears |
|---|---|---|
| `amendment` | A recorded change names this provision: who amends it, from when, how, and the new wording quoted | `brief`, `playbook`, `get`, `related`, `cite` (a match) |
| `version` | `as_of` was answered with the current text because no version is recorded for that date; do not present it as the text of that date | `get`, `brief` |
| `outside_library` | The instrument asked about is not held, or the document is held only in part | `cite` |
| `placeholder` | The text names an instrument by a pre-adoption number ("Regulation (EU) xx/xx"), which is not a citation | `get`, `related`, `brief` |
| `weak_match` | The best match covers little of the question; the topic may not be in the library | `brief`, `search` |

## `brief`

The first call for any substantive question.

| Input | Type | |
|---|---|---|
| `question` | string, 3+ chars | The question in the user's own words, abbreviations and all |
| `as_of` | ISO date, optional | When the question is about the text in force on a past day |
| `budget` | `short` \| `standard` \| `long` | About 2.5k, 5k or 9k tokens (default `standard`) |

It scores each playbook on its title, questions, summary and requirements and on the provisions the question finds that the playbook cites, and picks one only above a floor. The playbook is rendered within the budget; then come the provisions the question lands on that it does not cite, neighbouring playbooks and the notes. When a second playbook is nearly as good a fit it is rendered beside the first. When none clears the floor, `brief` says so and returns the best passages grouped by document.

Returns text (also in `structuredContent.text`, so a client that shows the model only structured content still delivers the playbook) plus `playbook` (`id`, `title`, `status`, or null), `confidence`, `also_relevant`, `close_second`, `other_playbooks` and `notes`.

```
brief { "question": "How is the long-run average PD derived?", "budget": "short" }
```

```text
# Long-run average default rate for PD calibration

Estimate each grade's PD from the long-run average of its one-year default rates (Art. 180(1)(a) CRR), and show that the average
reflects the likely range of variability of those rates, including downturn periods relevant to the portfolio (EBA/GL/2017/16 para 78). ...

## What it rests on
- Art. 180(1)(a) CRR (law): PDs are estimated by obligor grade from long-run averages of one-year default rates.
  > "Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates." (Art. 180(1)(a) CRR)
...
## What has to be shown
### R1. Estimate PDs by grade from long-run averages
...
```

A question the library has no playbook for:

```text
No playbook answers this question directly. The best passages follow, grouped by document.

Nothing in the library matches the question's terms. Not finding a match is a statement about what this library holds, not about the law.
```

## `playbook`

One playbook for one topic, as text.

| Input | Type | |
|---|---|---|
| `id` | string | A playbook id from `topics` or `brief`, in full (`playbook://pd-long-run-average`) or just the name after the scheme |
| `section` | `R1`, `R2`, … | One requirement, with the full text of its provisions |

The rendering is deterministic (`src/render.ts`). A citation is always the provision's official citation, built from its id and its document's citation style, never the compiler's wording. Each source is labelled with its force (law, delegated act, EBA guideline, ECB supervisory expectation), methods are marked regulatory or market practice, and the library's gaps are listed under "Not in this library". Returns `text`, `id`, `title`, `status`, `requirements` (`id` and `title` of each), `abridged` when the budget shortened a section, and `notes`.

An unknown id is a miss that lists the playbooks that exist.

## `topics`

No input. The areas of the library and the playbook under each topic: `areas[].playbooks[]` with `id`, `title` and a one-line `scope`. Only topics with a playbook appear.

```json
{"areas":[{"id":"calibration","title":"Calibration","playbooks":[{"id":"playbook://pd-long-run-average","title":"Long-run average default rate for PD calibration","scope":"How the long-run average one-year default rate is estimated and shown to be representative of the range of variability."}]}]}
```

## `search`

Ranked passages for a specific wording. Ranking is BM25F over weighted fields (heading path, citation, text, commentary) with stemming and an abbreviation glossary the corpus can carry; checks, tests and playbooks have their own field sets.

| Input | Type | |
|---|---|---|
| `query` | string, 2+ chars | Search phrase |
| `scope` | `provisions` (default) \| `checks` \| `tests` \| `playbooks` | Which kind of entry to search |
| `document` | string, optional | Provisions only: restrict to one document by its id (as `sources` lists them) |
| `limit`, `offset` | int | Page size (default 20, max 100) and how many ranked matches to skip |
| `detail` | `concise` (default) \| `full` | A per-kind projection, or complete entries |

Returns `results`, `returned`, `total_matches` (every match, not the page), `offset`, `truncated`, `next_offset`, `query_tokens` (distinct meaningful terms in the query), `best_coverage` (the most terms any match covered) and, per row, `coverage`. Provision rows carry the official `citation` and a `matched_excerpt` made of whole sentences, so the excerpt can be quoted without reopening the provision. Read `best_coverage` against `query_tokens` before treating the top row as an answer: when it is under half, a `weak_match` note says the topic may not be in the library. Provisions that are background are never searched.

```
search { "query": "long-run average" }
```

```json
{"results":[{"id":"regulation://crr/180/1/a","citation":"Art. 180(1)(a) CRR","matched_excerpt":"Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates.","document_id":"crr","coverage":3},{"id":"regulation://eba/gl-2017-16/78","citation":"EBA/GL/2017/16 para 78","matched_excerpt":"When calibrating PDs, institutions should ensure that the long-run average default rate ...","document_id":"eba-gl-2017-16","coverage":3}],"returned":2,"total_matches":2,"offset":0,"truncated":false,"next_offset":null,"query_tokens":3,"best_coverage":3}
```

## `get`

Open entries by id: provisions (verbatim text and commentary), checks, tests and sources, mixed freely, up to 20 per call.

| Input | Type | |
|---|---|---|
| `ids` | string or string[] | `regulation://`, `check://`, `test://` or `source://` ids, as `search`, `related` and `brief` return them |
| `as_of` | ISO date, optional | Provisions only: the text in force on that date |

Returns `records`, `missing` (each id with a reason; a miss on a part-held document says so, because the provision is absent from the library, not necessarily from the law) and `notes`. A page that would exceed the size ceiling is shortened (commentary first, then trailing entries) and says what it left out in `notice`.

`as_of` selects the last recorded version at or before the date. A date before the document existed is a miss, never today's text relabelled. When the library records no version for the date, the current text is returned with a `version` note.

```
get { "ids": ["regulation://crr/178/1/a"], "as_of": "2020-01-01" }
```

```json
{"notes":[{"type":"version","text":"This library has no version of this provision for the requested date (2020-01-01). The text below is the version dated 2024-01-09, which may differ from the text in force on that date. Do not present it as the text of that date.","applies_to":["Art. 178(1)(a) CRR"]}],"records":[{"id":"regulation://crr/178/1/a", ... }]}
```

## `cite`

Resolve a citation as people write it (`"Art. 178(1)(a) CRR"`, `"EBA GL 2017/16 para 78"`, `"Chapter 3 paragraph 233"`) to the provision it names.

| Input | Type | |
|---|---|---|
| `text` | string | A citation in prose |

Returns `match` (the provision, or null), `confidence` (`exact`, `alias` or `none`), `candidates`, `ambiguous`, `unmatched_segments`, `official_citation` and `notes`.

**Matching is exact, in a fixed order; there is no fuzzy fallback.** A confident wrong citation is the worst failure the server can produce, so `match` is null when nothing matches, when several provisions fit (they come back as `candidates`), when only a narrower or containing provision exists (reported as a candidate, `match` still null), and when the instrument is not in the library. An `alias` match means the caller used a loose spelling the provision declares (for example "Article 178" for a guideline paragraph 178) and the note names the real citation. An instrument is recognised by its number in every standard spelling, by its identifier and by its description ("the RTS on ..."), so a provision of another document that merely shares the number is never returned. The reason for a null match is an `outside_library` note.

```
cite { "text": "Article 5 of Regulation (EU) 2019/2033" }
```

```json
{"notes":[{"type":"outside_library","text":"This library holds no Regulation (EU) 2019/2033. Nothing was matched, rather than sourcing a same-numbered provision from another document. The library's overview lists the documents it holds."}],"match":null,"confidence":"none","candidates":[],"ambiguous":false,"unmatched_segments":[]}
```

## `related`

What surrounds an entry.

| Input | Type | |
|---|---|---|
| `id` | string | A provision, check, test or playbook id |
| `as_of` | ISO date, optional | Provisions only: amendments are read as of this day |

For a provision: `citation`, `document_id`, `heading_path`, `parent`, `siblings`, `cites` and `cited_by` (provisions, from the citations the text makes), `checks` and `tests` that restate it (those naming it as their primary basis first), `playbooks` that rely on it with the requirement handles, and `notes` for amendments. For a check or test: the provisions it rests on and the playbooks that use it. For a playbook: the playbooks it points to. Every link is an id the library already holds; nothing is inferred.

```
related { "id": "regulation://crr/180/1/a" }
```

```json
{"id":"regulation://crr/180/1/a","citation":"Art. 180(1)(a) CRR","document_id":"crr","parent":{"id":"regulation://crr/180","citation":"Art. 180 CRR"},"siblings":[],"cites":[],"cited_by":[],"checks":[{"id":"check://calibration/pd/lra-derived","name":"PD long-run average derived from sufficient history"}],"tests":[{"id":"test://jeffreys","name":"Jeffreys test"},{"id":"test://binomial","name":"Binomial test"},{"id":"test://hosmer-lemeshow","name":"Hosmer-Lemeshow test"}],"playbooks":[{"id":"playbook://pd-long-run-average","title":"Long-run average default rate for PD calibration","requirements":["R1"]}]}
```

## `sources`

What the library holds and how current it is.

| Input | Type | |
|---|---|---|
| `id` | string, optional | A source id or a document id |

Without `id`: `documents` (each with `status`, `held` as `whole`, `part` or `undeclared`, `provisions` held, `verified`, `next_milestone`, `open_changes`), `counts`, `changes` (recorded changes the text does not yet include, each with its state today) and `overdue_for_check` (current documents not confirmed within 30 days). With `id`: the whole entry with each change and its computed `state`: `upcoming`, `in_force_not_ingested` ("the text served may no longer be the text in force") or `undated`.

`held: "part"` means the document is declared partly held: not finding a provision there is not evidence it does not exist. `undeclared` means nobody declared either way, which is not the same as whole. See [Corpus structure](/corpus/#declaring-coverage).

## Resources and the prompt

One resource template per URI scheme, each reading an entry by id: `regulation://{+path}`, `test://{+path}`, `check://{+path}`, `playbook://{+path}` (rendered as text) and `source://{+path}`. Ids autocomplete.

The prompt `walk_through(topic, focus?)` asks the model to call `brief`, go through the requirements in order citing provisions officially, keep law, guidelines, supervisory expectations and practice apart, repeat every note, and end with the pitfalls and the gaps.

## Migrating from 0.x

0.x had nineteen tools. 1.0 replaced them with the eight above; the old-to-new table is in [the 1.0 design](/design/1.0#migrating-from-0-x).
