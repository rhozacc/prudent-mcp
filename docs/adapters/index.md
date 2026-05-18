# Adapters

The MCP server reaches its corpus through a small set of adapter interfaces defined in `src/adapters.ts`. In the open-source distribution the adapters are empty defaults — the server boots and answers MCP calls without crashing, it just has nothing to say. Pointing them at a corpus turns the lights on.

## The interfaces

```ts
interface RegulationAdapter {
  search(query: string): Promise<Regulation[]>;
  get(id: RegulationId, asOf?: string): Promise<Regulation | null>;
}

interface TestAdapter {
  search(query: string): Promise<Test[]>;
  get(id: TestId): Promise<Test | null>;
}

interface CheckAdapter {
  search(query: string): Promise<Check[]>;
  get(id: CheckId): Promise<Check | null>;
}

interface PlaybookAdapter {
  search(query: string): Promise<Playbook[]>;
  get(id: PlaybookId): Promise<Playbook | null>;
}

interface MetaAdapter {
  info(): Promise<CorpusInfo>;
  referrers(id: string): Promise<Referrers>;
  resolveCitation(text: string): Promise<Regulation | null>;
  taxonomy(): Promise<ReviewArea[]>;
}
```

## Connecting a corpus

The `adapters` object is mutable. Reassign its handles at startup:

```ts
import { adapters } from "prudent-mcp/adapters";
import { HttpRegulationAdapter } from "./my-corpus.ts";

adapters.regulation = new HttpRegulationAdapter("https://corpus.example.com");
adapters.test   = new HttpTestAdapter(/* ... */);
adapters.check  = new HttpCheckAdapter(/* ... */);
adapters.playbook = new HttpPlaybookAdapter(/* ... */);
adapters.meta   = new HttpMetaAdapter(/* ... */);

import { createServer } from "prudent-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createServer();
await server.connect(new StdioServerTransport());
```

## The in-memory demo as a template

`examples/inmemory-demo.ts` is the reference implementation. It seeds a small slice of PD-calibration content into in-memory maps and implements all five adapter interfaces against them. Use it as the template when building your own backend.

Key things the demo shows:

- **`search(query)`** — simple `Array.filter` + `.toLowerCase().includes()` against record fields
- **`get(id, asOf?)`** — direct map lookup; `asOf` triggers version-history selection for regulation
- **`resolveCitation(text)`** — pattern-match on prose strings to structured IDs
- **`referrers(id)`** — scan `Check.derived_from` and `Phase.references` to build back-references

For a production adapter, replace the in-memory maps with HTTP calls, a database, or whatever backs the corpus. The interface contract is the same.

## Record validation

Records crossing the adapter boundary are validated at the handler level via zod. Invalid records are rejected before they reach the MCP response. The JSON Schemas under `docs/schemas/` are the portable, language-agnostic form of the same contract — use them to validate records in your adapter build pipeline:

```bash
bun run schemas   # regenerate docs/schemas/*.schema.json from src/schema.ts
```
