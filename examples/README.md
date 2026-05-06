# examples

Worked example for exercising the design end to end.

- `inmemory-demo.ts` — single-file demo: seed records + adapter implementations + server wire-up. PD calibration as the cohesive slice; default-definition aside drives the `as_of` lookup.

## Run

```bash
bun run inspect:demo                # interactive MCP Inspector
bun run demo                        # plain stdio
```

## Things worth poking at

| Tool call | What you should see |
|---|---|
| `get_corpus_info` | counts (4/3/3/2) and coverage (CRR, EBA-GL-2017-16) |
| `list_review_areas` | `calibration` with two children, plus two flat siblings |
| `search_regulation` `"long-run average"` | hits CRR 180/1/a and EBA GL para 78 |
| `get_regulation` `"regulation://crr/178/1/b"` | latest text, version 2024-01-09 |
| `get_regulation` with `as_of: "2018-01-01"` | 2013-vintage text — `document_version` differs |
| `resolve_citation` `"CRR Art. 180(1)(a)"` | resolves to the structured Regulation |
| `get_referrers` `"regulation://crr/180/1/a"` | LRA check + PD calibration playbook |
| `get_test` `"test://jeffreys"` | `family="calibration-binomial"` and aliases |
| `get_playbook` `"playbook://calibration/pd"` | three phases with mixed-surface references |

This is a development-time adapter — substring search, regex citation resolution, hand-typed seed. Real backends implement the same `*Adapter` interfaces with whatever storage and search behaviour they need.
