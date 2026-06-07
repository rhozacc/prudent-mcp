/**
 * Pluggable backends — one interface per surface, plus a meta adapter for
 * cross-cutting ops.
 *
 * Default implementations return empty results. The server boots, registers
 * all surface area, and answers MCP calls without crashing — it just has
 * nothing to say.
 *
 * Connect a corpus by reassigning the exported `adapters` object:
 *
 *   import { adapters } from "prudent-mcp/adapters";
 *   import { HttpRegulationAdapter } from "./my-corpus.ts";
 *   adapters.regulation = new HttpRegulationAdapter("https://corpus.example.com");
 */
import type {
  Check,
  CheckId,
  CorpusInfo,
  Playbook,
  PlaybookId,
  Referrers,
  Regulation,
  RegulationId,
  ReviewArea,
  Test,
  TestId,
} from "./schema.ts";

export type { Referrers } from "./schema.ts";

// --- Interfaces --------------------------------------------------------------

export interface RegulationAdapter {
  search(query: string): Promise<Regulation[]>;
  get(id: RegulationId, asOf?: string): Promise<Regulation | null>;
}

export interface TestAdapter {
  search(query: string): Promise<Test[]>;
  get(id: TestId): Promise<Test | null>;
}

export interface CheckAdapter {
  search(query: string): Promise<Check[]>;
  get(id: CheckId): Promise<Check | null>;
}

export interface PlaybookAdapter {
  search(query: string): Promise<Playbook[]>;
  get(id: PlaybookId): Promise<Playbook | null>;
}

export interface MetaAdapter {
  info(): Promise<CorpusInfo>;
  referrers(id: string): Promise<Referrers>;
  resolveCitation(text: string): Promise<Regulation | null>;
  taxonomy(): Promise<ReviewArea[]>;
}

// --- Empty defaults ----------------------------------------------------------

const emptyRegulation: RegulationAdapter = {
  async search() { return []; },
  async get() { return null; },
};

const emptyTest: TestAdapter = {
  async search() { return []; },
  async get() { return null; },
};

const emptyCheck: CheckAdapter = {
  async search() { return []; },
  async get() { return null; },
};

const emptyPlaybook: PlaybookAdapter = {
  async search() { return []; },
  async get() { return null; },
};

const emptyMeta: MetaAdapter = {
  async info() {
    return {
      last_updated: new Date().toISOString(),
      counts: { regulation: 0, test: 0, check: 0, playbook: 0 },
      coverage: [],
    };
  },
  async referrers() {
    return { regulation: [], tests: [], checks: [], playbooks: [] };
  },
  async resolveCitation() { return null; },
  async taxonomy() { return []; },
};

// --- Mutable handles — reassign at startup time to connect a corpus --------

export const adapters = {
  regulation: emptyRegulation,
  test: emptyTest,
  check: emptyCheck,
  playbook: emptyPlaybook,
  meta: emptyMeta,
};
