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
| `topics` | the calibration area and its one playbook |
| `brief` `"How is the long-run average PD derived?"` | the playbook as text: what it rests on, what has to be shown, methods, pitfalls |
| `playbook` `"pd-long-run-average"`, `section: "R2"` | one requirement with the full text of its provisions |
| `search` `"long-run average"` | hits CRR 180/1/a and EBA GL para 78, with coverage |
| `get` `"regulation://crr/178/1/a"` | the provision plus an `amendment` note (the demo carries one applying in 60 days) |
| `get` `"regulation://crr/178/1/b"` with `as_of: "2018-01-01"` | 2013-vintage text — `document_version` differs |
| `cite` `"CRR Art. 180(1)(a)"` | resolves to the provision |
| `cite` `"Article 5 of Regulation (EU) 2019/2033"` | `match: null` and an `outside_library` note |
| `related` `"regulation://crr/180/1/a"` | LRA check, tests and the playbook requirement resting on it |
| `sources` | each document held whole, in part or undeclared, and the open change |

This is a development-time adapter: hand-typed seed, shared ranking and citation resolver. Real backends implement the same `*Adapter` interfaces with whatever storage they need.
