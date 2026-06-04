# Quickstart

```bash
# Install Bun (once)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/rhozacc/prudent-mcp.git
cd prudent-mcp
bun install

# Verify it builds and the in-memory demo runs
bun run typecheck
bun test
bun run inspect:demo
```

The last command opens the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) in your browser, connected to a server pre-seeded with a small slice of PD-calibration content.

## Dev environment setup

### 1. Bun

Bun replaces npm/pnpm/yarn, tsx, and (optionally) vitest. One install:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"

# verify
bun --version    # should print 1.x
```

If you can't install Bun, the project will also work under Node 20+ with `tsx` — but the scripts in `package.json` assume Bun.

### 2. Editor

VSCode / Cursor / any editor with TypeScript LSP. The included `tsconfig.json` is what the LSP reads.

Type-on-hover and go-to-definition are the day-to-day tools that make the abstraction tractable. Fix them before writing code.

### 3. Install and verify

```bash
bun install
bun run typecheck
bun test
```

`typecheck` should be silent. `bun test` should pass the smoke test.

### 4. Run the demo

```bash
bun run inspect:demo
```

This starts an in-memory server (`examples/inmemory-demo.ts`) seeded with a small slice of content and opens the MCP Inspector against it. Things worth poking at:

| Try | What you'll see |
|---|---|
| `get_corpus_info` | counts and coverage |
| `list_review_areas` | the taxonomy tree |
| `search_regulation` `"long-run average"` | hits CRR 180/1/a and EBA GL para 78 |
| `get_regulation` `"regulation://crr/178/1/b"` | latest text + EBA commentary |
| `get_regulation` with `as_of: "2018-01-01"` | the older 2013-vintage text |
| `get_referrers` `"regulation://crr/180/1/a"` | check://calibration/pd/lra-derived + playbook://calibration/pd |
| `get_playbook` `"playbook://calibration/pd"` | three phases with mixed-surface references |
| `expand_playbook` `"playbook://calibration/pd"` | same, with every reference resolved inline |
| `get_area_overview` `"calibration.pd"` | area node + expanded playbooks + deduplicated ID lists |
| `expand_regulation` `"regulation://crr/180/1/a"` | the paragraph with its check/test children resolved inline |
| `get_regulation_tree` `"regulation://crr/180"` | the article as a dossier — sub-paragraphs + operationalizing checks/tests |
| `get_coverage_gaps` | regulations with no check/test coverage |
| `get_check` `"check://calibration/pd/lra-derived"` | expectation + expected_evidence list |
| `bun run list` | full corpus overview to stdout |

### 5. Connect a real client

For **Claude Desktop**, edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"
      ]
    }
  }
}
```

For **Claude Code**, create or edit `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "prudent": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/prudent-mcp/examples/inmemory-demo.ts"
      ]
    }
  }
}
```

Restart the client. The `prudent` server should appear in the tools list. Same shape works for Cursor and any other MCP-compliant host.
