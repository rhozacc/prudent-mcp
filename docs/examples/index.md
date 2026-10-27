# Examples

Four sessions against the seeded demo, in the order a model works: `brief`, then `playbook`, then `get` and `cite` on the provisions it names. Every reply is real output (`bun run evals:call <tool> '<json>'` reproduces it; long replies are cut with `...`). The demo holds one playbook and a few provisions; a real corpus answers the same way over more material.

## 1. "How is the long-run average PD derived?"

> **Analyst:** Starting a PD calibration review. What does the long-run average have to show, and what will a reviewer ask for?

One call. The question goes to `brief` in the analyst's own words:

```
brief { "question": "How is the long-run average PD derived?" }
```

```text
# Long-run average default rate for PD calibration

Estimate each grade's PD from the long-run average of its one-year default rates (Art. 180(1)(a) CRR), and show that the average reflects the
likely range of variability of those rates, including downturn periods relevant to the portfolio (EBA/GL/2017/16 para 78). What counts as a long
enough history is a matter of your own policy and the portfolio.

## What it rests on
- Art. 180(1)(a) CRR (law): PDs are estimated by obligor grade from long-run averages of one-year default rates.
- EBA/GL/2017/16 para 78 (EBA guideline): The calibration target must reflect the likely range of variability of one-year default rates, downturn periods included.

## What has to be shown
### R1. Estimate PDs by grade from long-run averages
...
A reviewer will ask to see: the grade-level default-rate series; the averaging method and its documentation.
Checks: PD long-run average derived from sufficient history.

### R2. Show the target reflects the range of variability
...
## Methods
- Average the grade-level one-year default rates over the full window (regulatory; Art. 180(1)(a) CRR): ...
- Compare the target with an external default-rate series (market practice, not a regulatory requirement): ...

## Pitfalls
- Using the most recent years only understates a downturn the window did not contain. (EBA/GL/2017/16 para 78)

## Not in this library
- The Commission Delegated Regulation on the IRB assessment methodology: It sets further requirements on the observation period that this topic does not reproduce.
```

> **Claude:** The estimate has to come from the long-run average of each grade's one-year default rates, not the latest year (Art. 180(1)(a) CRR), and the average has to reflect the range of variability including downturn periods (EBA/GL/2017/16 para 78). Expect to show the default-rate series, the averaging method and the downturn periods covered. Comparing with an external series is market practice, not a requirement. The Commission's delegated regulation on the assessment methodology sets further requirements on the observation period that this playbook does not reproduce.

Note what the answer does not do: it cites by official citation, never by id; it keeps law, guideline and practice apart as the playbook labels them; and it names the instrument the library lacks instead of guessing at it.

## 2. One requirement in full

The reviewer wants the exact wording behind R2:

```
playbook { "id": "pd-long-run-average", "section": "R2" }
```

returns that requirement with the full text of every provision it cites. The playbook's id came from `topics` or from the `playbook` field of the `brief` reply.

## 3. "What does Art. 178(1)(a) say, and is it changing?"

`cite` turns the citation as the analyst typed it into the provision:

```
cite { "text": "Art. 178(1)(a) CRR" }
```

`get` opens it:

```
get { "ids": ["regulation://crr/178/1/a"] }
```

```json
{"notes":[{"type":"amendment","text":"Pending change to this provision: Amending Regulation (demo) (Article 1) replaces this provision from 2026-12-26 (in 60 days); the text below is the version before it. New wording: “Article 178(1)(a) is replaced by the following: a default shall be considered to have occurred when the institution considers that the obligor is unlikely to pay its credit obligations in full, whether or not security is realised.”.","applies_to":["Art. 178(1)(a) CRR"]}],"records":[{"id":"regulation://crr/178/1/a","citation":"CRR Article 178(1)(a)","text":"A default shall be considered to have occurred when the institution considers that the obligor is unlikely to pay its credit obligations in full ...","commentary":[{"source":"EBA GL 2016/07 para 47","text":"Institutions should use objective indicators of unlikeliness to pay, including: ..."}], ... }]}
```

> **Claude:** Art. 178(1)(a) CRR is the unlikeliness-to-pay limb of the default definition; the EBA commentary lists the objective indicators. It is due to be replaced from the date in the note, with new wording on the role of realising security, so for a review after that date the text above is the version before the change.

The `amendment` note is computed from the amending instrument's own provision, which names its target, and appears only on the provisions it names. A model is told to repeat every note.

## 4. A citation the library cannot answer

```
cite { "text": "Article 5 of Regulation (EU) 2019/2033" }
```

```json
{"notes":[{"type":"outside_library","text":"This library holds no Regulation (EU) 2019/2033. Nothing was matched, rather than sourcing a same-numbered provision from another document. The library's overview lists the documents it holds."}],"match":null,"confidence":"none","candidates":[],"ambiguous":false,"unmatched_segments":[]}
```

`match` is null and there are no candidates: a provision of a held document that happens to be numbered 5 would be a confident wrong citation, which is the failure `cite` is built to avoid. The same discipline applies to a question: when `brief` has no playbook for it, it says so and returns the best passages with a `weak_match` note when they cover little of the question.

## Going wider

- `search { "query": "long-run average" }` finds provisions by their own words; read `best_coverage` against `query_tokens` before trusting the top row.
- `related { "id": "regulation://crr/180/1/a" }` shows the check and tests that restate it and the playbook requirement that rests on it.
- `sources` says what the library holds, whole, in part or undeclared, and which changes the text does not yet include.
- `get { "ids": [...], "as_of": "2018-01-01" }` reads a provision as it stood on a past date; where no version is recorded for the date the reply says so and does not pass the current text off as the old one.

See [Tools](/tools/) for every input and reply.
