# Context evals

`bun test` proves the server is **correct**. These evals ask a different question: is what the server hands a model **good context** — precise, honest, and affordable?

```bash
bun run evals                                       # seeded demo corpus
CORPUS_FILE=/path/to/corpus.json bun run evals      # a real corpus
bun run evals -- --json                             # machine-readable
bun run evals:call search_checks '{"query":"..."}'  # drive one tool by hand
```

## What is being measured

The unit is the **call trace**: for every tool call, the bytes that land in the model's context, the latency, and whether it errored. Every invariant is expressed over traces, so a claim is always tied to an observation rather than to a reading of the source.

| | invariant | the belief it protects |
|---|---|---|
| I1 | Response bodies are valid JSON | the body has the shape the schema promises |
| I2 | Ids shown in tool descriptions resolve | the addressing scheme the model infers is the real one |
| I3 | Citation resolution is honest | a returned citation is the one that was asked for |
| I4 | Reported totals are true | "I have seen all the matches" |
| I5 | Ids handed out are fetchable | an id from a search result can be opened |
| I6 | Context cost stays within budget | there is context left for the actual task |
| I7 | Misses are actionable | a dead end names the way out |
| I8 | Records are findable by their own words, affordably | asking for a thing returns the thing, at a price worth paying |

I8 is the one that measures the product rather than the plumbing: it takes a record the corpus already holds, queries with the words that make it distinctive, and asks whether the server gives it back — at what rank and at what cost. The questions are derived from the served corpus, so it stays corpus-agnostic: every probe is "find the thing you told me you have".

Cost findings (I6) are budgeted; the rest are about truthfulness, and a model believing something the corpus did not say is the failure this suite exists to catch. Volume is a cost. **A confident wrong answer is a defect.**

## Two rules that keep the suite honest

**Corpus-agnostic by construction.** Every invariant is a property of the *server*, evaluated against whatever `CORPUS_FILE` points at — the seeded demo in CI, a real corpus locally. A bar that only holds for one corpus is a fixture, not a bar. No corpus content lives in this directory.

**Nothing passes by having nothing to measure.** An invariant with no data reports `applicable: false` rather than passing, and a run in which *every* invariant is inapplicable exits 1. This is why the default target is the seeded demo rather than the MCPB entry — that entry with no `CORPUS_FILE` serves empty adapters, against which the whole suite would sail through green.

That distinction is not hypothetical. An invariant like I2 can **pass on the demo corpus and fail on a real one**: a tool description that offers an example id which happens to exist in the demo seed teaches every model an addressing scheme the served corpus may not use. Running the suite only against the demo would certify that defect as fixed.

So: run it against the corpus you actually ship, and keep the findings wherever that corpus lives. **They do not belong here** — a defect report naming real ids, record counts and document coverage describes the corpus, not the server, and this repository is public.

## Adding an invariant

Add a function returning `InvariantResult` to `invariants.ts` and list it in `ALL`. Requirements:

- State the belief it protects, not the mechanism it inspects.
- Put a **value** in `evidence` — the id that failed, the two numbers that disagree. Never restate the summary.
- Return `applicable: false` when there was nothing to bind on.
- Severity is `fatal` for truthfulness, `warn` for cost, `info` for observations.

## Wired into `test:ci`, and `test:ci` is wired into CI

It opened at 17 fatal findings — it was written to characterise the server before fixing it — and is now **0 fatal against both the seeded demo and a real corpus**, so it runs in `test:ci` as a regression gate rather than a report. A fatal finding fails the build.

That sentence was true of the script and false in effect for longer than it should have been: `ci.yml` ran `typecheck`, `bun test` and `validate` as three separate steps and never invoked `test:ci`, so the suite ran in no workflow at all. CI now runs the script itself, which is what stops the two drifting again — a check added to `test:ci` is added to CI by construction.

**What CI cannot see.** The workflow evaluates the seeded demo, because this repo holds no corpus and a failing log from a real one would name record content in public. So the demo run is a floor, not a verdict: it cannot bind I2 or I3, and the numbers that matter for answer quality — excerpt quotability, retrieval cost per question — are only meaningful against a corpus with real prose in it. Run `CORPUS_FILE=… bun run evals` for that, and gate it where the corpus lives.

Two invariants report `applicable: false` against the demo and that is the honest state, not a gap to paper over:

- **I2** binds only when a tool description or input schema contains a literal id. There are none: every example is a template shape naming the tool that hands out real ids. If someone reintroduces a literal, I2 binds again and checks it — which is the point of the check.
- **I3** needs article-numbered ids to derive a provably-absent article number from, and the demo seed has none. It binds against a real corpus. This is the case the two rules above exist for: a bar that only holds for one corpus is a fixture, so run the suite against the corpus you ship.

The cost warning (`I6/surface`) stands deliberately. Nineteen tools cost ~4,700 tokens of standing context against a 3,000 budget, and the fix is not to cut the guidance — descriptions are how a model learns not to make the wrong call, and a wrong call costs more than the words that would have prevented it. Closing it properly means publishing fewer tools.
