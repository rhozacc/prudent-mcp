# Contributing to prudent-mcp

Thanks for looking. This is a small, opinionated codebase — a read-only MCP server over a
structured knowledge base for IRB credit-risk model validation — and most of what follows
exists to keep it that way.

## Before you open a pull request

Two things that are easy to get wrong here, and expensive to undo:

**Never commit corpus content.** The curated corpus is a separate proprietary product and
must not enter this repository, in any form — not a sample, not a fixture, not a test file
"just to reproduce something". `.gitignore` firewalls `corpus.json`, `*.corpus.json` and
`data/`, but that is a safety net, not permission to work around. The adapters in this repo
return empty results by default, and `examples/inmemory-demo.ts` seeds a small synthetic
slice for development. Use that.

**The server stays read-only.** No write tools, no execution, no orchestration. The server
describes; computation lives elsewhere. A pull request that adds a mutation path or runs a
model will be declined however well it is written — the boundary is the product, not an
oversight. `CLAUDE.md` documents the other standing constraints (versioning only on
`Regulation`, typed cross-surface references, strict TS with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` both on).

## Development

Requires [Bun](https://bun.sh) ≥ 1.1. There is no `tsc` build step for local work.

```bash
bun install
bun run typecheck     # tsc --noEmit
bun test
bun run validate      # corpus integrity linter
```

`bun run test:ci` chains all three. CI runs the same three commands as separate steps, after
`bun install --frozen-lockfile` — so a green `test:ci` locally means a green CI, and a
lockfile you forgot to commit is the one thing that will still catch you out.

Useful while working:

```bash
bun run inspect:demo  # MCP Inspector against the seeded demo server
bun run list          # full corpus overview to stdout
bun run demo          # run the in-memory demo directly
```

### If you change a zod schema

Regenerate the committed artifacts and include them in the same commit:

```bash
bun run schemas       # JSON Schemas under docs/schemas/ + the rendered reference
```

`tests/schema-drift.test.ts` byte-compares the committed schemas against what the live zod
definitions produce, so forgetting this fails CI rather than shipping a stale contract. If
you add a new named schema, register it in `scripts/schema-registry.ts` — that one list
drives the generator, the docs, and the drift test.

### If you change the surfaces or tools

- `tests/smoke.test.ts` hardcodes the tool, template and prompt counts. That tripwire is
  deliberate: a new tool must land together with its registration and its count bump.
- Cross-surface references are typed via template literal URI types (`RegulationId`,
  `CheckId`, …). Do not widen them to `string` to make an error go away — the error is the
  feature.
- `related` (through `src/referrers.ts`) is the single computed reverse index. Don't add a second scan.

### If you change the docs

```bash
bun run docs:dev      # local VitePress server
bun run docs:build    # what the deploy workflow runs
```

Stale counts and surface lists are treated as bugs here, not cosmetics.

## Pull requests

Branch off `main`, keep the change focused, and explain *why* in the description — the diff
already shows what. Small, self-contained pull requests get read and merged; large mixed
ones sit. If you are planning something substantial, open an issue first so we can agree the
shape before you spend the time.

Commit messages: a short imperative subject, then prose explaining the reasoning if it isn't
obvious.

## Licence and the CLA

This project is licensed **AGPL-3.0-only** (see [LICENSE](./LICENSE)). Contributions are
accepted on those terms: what you submit is licensed inbound under the same licence it goes
out under.

Pull requests carry a **Contributor Licence Agreement** check
([cla-assistant](https://cla-assistant.io/rhozacc/prudent-mcp)). The bot comments on your
first pull request with a link; signing is a one-time click and covers everything you send
afterwards.

The check reads the **commit authors** in the pull request, not the account that opened it.
That distinction bites: if your commits are authored under some other identity — a work
address, or a tool that commits as itself — the bot waits on *that* identity, and signing
with your own account leaves the check pending with nothing you can do to clear it. Either
sign with the account owning the authoring identity, or re-author the commits before you
push. `git log -1 --format='%an <%ae>'` tells you which one you are about to be judged on.

The CLA is not ceremony. prudent-mcp is offered under a commercial licence alongside the
AGPL — for embedding, OEM and on-prem deployments where copyleft does not fit — and that is
only possible while every line in the repository can be licensed on both sets of terms.
Without a signed grant covering relicensing and sublicensing, a single unsigned contribution
would permanently remove that option for everyone. The agreement asks for exactly that grant
and nothing more: you keep the copyright in your work.

If you would rather not sign, that is a legitimate choice — open an issue describing the
problem you hit, and it can be addressed independently.

### Third-party code

Anything bundled into the shipped `.mcpb` must have its notice recorded in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md). Adding a runtime dependency means adding
its licence text there in the same pull request. Runtime dependencies are kept deliberately
few — there are two — so a new one needs a reason.

## Reporting a security issue

Please don't open a public issue. Use GitHub's private vulnerability reporting on this
repository (Security → Report a vulnerability), and allow time for a fix before disclosure.
