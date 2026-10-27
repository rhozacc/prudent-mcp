# prudent-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that gives an LLM client structured
access to the IRB credit-risk regulatory knowledge base: regulation, statistical tests,
supervisor checks, review playbooks, and a registry of the source documents it all derives from.

Anyone whose model has to reason about this material works from the same surface — analysts,
validators, supervisors, auditors, developers building on top of it.

**[Documentation](https://rhozacc.github.io/prudent-mcp/)** · **[Download](https://github.com/rhozacc/prudent-mcp/releases/latest)**

## Why

Working with an IRB model — building it, reviewing it, supervising it, writing about it — means
cross-referencing against a moving target: CRR articles, EBA guidelines, ECB guides, supervisor
commentary, statistical methodology. An LLM is good at that cross-referencing, but only with
structured access to the source material. Training-data recall is not good enough when the answer
has to survive a supervisor, and a plausible citation that was never checked is worse than none.

So this server describes; it does not compute. No write tools, no execution, no orchestration.
That boundary is the design, not a gap.

## The five surfaces

Each has its own URI scheme, and cross-surface references are typed — a `check://` that claims to
derive from law must name a real `regulation://`.

| Surface | URI scheme | An entry asserts |
|---|---|---|
| Regulation | `regulation://{framework}/{article}[/{paragraph}[/{point}]]` | What the law says. Versioned; `get` takes an `as_of` date. |
| Tests | `test://[{family}/]{test-id}` | What a statistical test measures and when to trust it. Described, never run. |
| Checks | `check://{area}/{topic}[/{specific}]` | What a supervisor expects to see, traced to law via `derived_from`. |
| Playbooks | `playbook://{topic}` | What one topic requires, compiled across documents, with every requirement cited. |
| Sources | `source://{framework}/{document-id}` | Whether the regulatory context is current — verification dates, supersession, milestones. |

On top sit eight tools: `brief` routes a question to the playbook that answers it, `playbook` and
`topics` expand and list playbooks, `search`, `get` and `cite` open provisions, `related` walks to
their neighbours, and `sources` says what the library covers and what is changing. See the
[tool reference](https://rhozacc.github.io/prudent-mcp/tools/).

## Install

**Claude Desktop** — download the `.mcpb` from the
[latest release](https://github.com/rhozacc/prudent-mcp/releases/latest) and open it. Claude
Desktop installs it as an extension; an install-time prompt sets the optional corpus file path.
No toolchain required.

**Claude Code** — one line:

```bash
claude mcp add prudent --env CORPUS_FILE=/abs/path/corpus.json -- bun run /abs/path/prudent-mcp/src/mcpb-entry.ts
```

Or install it as a plugin (the folder `plugin/` of this repository, which carries the server as one bundled file
and runs it with `node`, so it needs no Bun): enable it and set the optional *Corpus file* when asked.

Leave `CORPUS_FILE` off to start empty. The same config shape works for Cursor and any other
MCP-compliant host — see [Clients](https://rhozacc.github.io/prudent-mcp/guide/clients).

**From source** — requires [Bun](https://bun.sh) ≥ 1.1:

```bash
bun install
bun run test:ci        # typecheck + tests + corpus linter
bun run inspect:demo   # MCP Inspector, pre-seeded with demo content
bun run build:mcpb     # produces mcpb.mcpb (gitignored; releases attach it)
```

## The corpus

The adapters here return **empty results by default**. This repository is the machinery — schemas,
tools, traversal, the corpus linter — not the content.

`examples/inmemory-demo.ts` seeds a small synthetic slice of PD-calibration content, and is the
reference implementation for any backend; see the
[adapter contract](https://rhozacc.github.io/prudent-mcp/adapters/). The curated **prudent
corpus** is a separate proprietary product, licensed and shipped separately.

Point `CORPUS_FILE` at a corpus JSON and it is linted on startup: broken cross-references,
supersession cycles and stale sources refuse to serve.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — development setup, the checks CI runs, the two
boundaries that are not negotiable (no corpus content in this repo, no write path in the server),
and the CLA.

## Licence

[AGPL-3.0-only](./LICENSE), covering the server code and only the server code.

Running it unmodified against your own corpus carries no obligation. Building on it is where the
copyleft bites: a modified version offered over a network must offer its source too (§13), which
reaches the transport, auth and metering layer a hosted deployment adds.

A corpus is data read at runtime, not a derivative work — nothing here reaches yours. For
embedding, OEM and on-prem, a **commercial licence** is available instead; contact Econlab.
Bundled third-party components are listed in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
