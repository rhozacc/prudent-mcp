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
  CitationResolution,
  CorpusInfo,
  Playbook,
  PlaybookId,
  Referrers,
  Regulation,
  RegulationId,
  ReviewArea,
  Source,
  SourceId,
  SourceStatus,
  Test,
  TestId,
} from "./schema.ts";

export type { Referrers } from "./schema.ts";

// --- Interfaces --------------------------------------------------------------
//
// list() vs search() — two different contracts on every content surface:
//
//   - list() returns ALL records. It is the internal traversal + enumeration
//     contract: cross-cutting tools (coverage gaps, area overviews), corpus
//     scripts, and validators use it when they genuinely need everything.
//   - search(query) is ranked relevance search (see src/search.ts) for a real
//     query. It never dumps the corpus: an empty or whitespace-only query
//     returns []. Do not lean on search("") to enumerate — that undocumented
//     contract is gone; call list() instead.

/**
 * What a record under an `as_of` date was served ON.
 *
 *   history — a recorded version covers the date; the text is the one then in force.
 *   current — no version is recorded for the date, so the current record was
 *             served because it is the best text the corpus has. It is NOT
 *             evidence of what was in force then, and the tool layer says so.
 *
 * A miss has no basis: there is nothing served to qualify.
 */
export type AsOfBasis = "history" | "current";

export type AsOfResolution =
  | { record: Regulation; basis: AsOfBasis }
  | { record: null };

export interface RegulationAdapter {
  /** Ranked search over citation/text/commentary. Empty query ⇒ []. */
  search(query: string): Promise<Regulation[]>;
  /**
   * Fetch one record, optionally as of an ISO date. `asOf` resolves against
   * the backend's version history; when the backend has no history for the id
   * it serves the only version it knows (the current one). When history
   * exists, the version in force on `asOf` is returned — or null when `asOf`
   * predates every known version. Backends must not silently serve current
   * text as historical.
   *
   * "Serves the current one" is the part a caller cannot see from the record
   * alone: today's text under a past date looks exactly like a historical
   * version. `resolveAsOf` is how an adapter says which it was.
   */
  get(id: RegulationId, asOf?: string): Promise<Regulation | null>;
  /**
   * OPTIONAL. The same resolution as `get(id, asOf)` with an `asOf` date, plus
   * the basis the record was served on — so the tool layer can attach an
   * `as_of_note` when the current text stands in for a version the corpus does
   * not record.
   *
   * Implement it as the single piece of logic and have `get` delegate to it, so
   * the two cannot disagree about what was served. The record must be exactly
   * what `get(id, asOf)` returns; only `basis` is new information.
   *
   * An adapter without it keeps compiling: the tools fall back to
   * `get(id, asOf)`, and no substitution note is attached because nothing says
   * the text was substituted. Absent is not "history" — it is "unknown". (A
   * record that `get(id, asOf)` cannot serve while `get(id)` can is still a gap
   * the tools report, since that is observable from `get` alone.)
   */
  resolveAsOf?(id: RegulationId, asOf: string): Promise<AsOfResolution>;
  /** ALL regulation records — enumeration/traversal contract, not search. */
  list(): Promise<Regulation[]>;
}

export interface TestAdapter {
  /** Ranked search over name/aliases/family/purpose/criteria. Empty query ⇒ []. */
  search(query: string): Promise<Test[]>;
  get(id: TestId): Promise<Test | null>;
  /** ALL test records — enumeration/traversal contract, not search. */
  list(): Promise<Test[]>;
}

export interface CheckAdapter {
  /** Ranked search over name/expectation/expected_evidence. Empty query ⇒ []. */
  search(query: string): Promise<Check[]>;
  get(id: CheckId): Promise<Check | null>;
  /** ALL check records — enumeration/traversal contract, not search. */
  list(): Promise<Check[]>;
}

export interface PlaybookAdapter {
  /** Ranked search over area/subarea/phase names+descriptions. Empty query ⇒ []. */
  search(query: string): Promise<Playbook[]>;
  get(id: PlaybookId): Promise<Playbook | null>;
  /** ALL playbook records — enumeration/traversal contract, not search. */
  list(): Promise<Playbook[]>;
}

// The registry is small and list-shaped, so unlike the content surfaces this
// adapter lists (optionally by status) rather than full-text searching.
export interface SourceAdapter {
  list(filter?: { status?: SourceStatus }): Promise<Source[]>;
  get(id: SourceId): Promise<Source | null>;
}

export interface MetaAdapter {
  info(): Promise<CorpusInfo>;
  referrers(id: string): Promise<Referrers>;
  /**
   * Loose citation → a resolution that can decline. Returns the whole
   * CitationResolution, not just the match: a bare `Regulation | null` cannot
   * express "several records are equally good" or "that instrument is not in
   * this corpus", so the adapter had to pick one silently, and the consumer
   * printed the guess as a citation.
   */
  resolveCitation(text: string): Promise<CitationResolution>;
  taxonomy(): Promise<ReviewArea[]>;
}

// --- Empty defaults ----------------------------------------------------------

const emptyRegulation: RegulationAdapter = {
  async search() { return []; },
  async get() { return null; },
  async list() { return []; },
};

const emptyTest: TestAdapter = {
  async search() { return []; },
  async get() { return null; },
  async list() { return []; },
};

const emptyCheck: CheckAdapter = {
  async search() { return []; },
  async get() { return null; },
  async list() { return []; },
};

const emptyPlaybook: PlaybookAdapter = {
  async search() { return []; },
  async get() { return null; },
  async list() { return []; },
};

const emptySource: SourceAdapter = {
  async list() { return []; },
  async get() { return null; },
};

const emptyMeta: MetaAdapter = {
  async info() {
    return {
      last_updated: new Date().toISOString(),
      counts: { regulation: 0, test: 0, check: 0, playbook: 0, source: 0 },
      coverage: [],
      stale_sources: [],
    };
  },
  async referrers() {
    return {
      regulation: [],
      tests: [],
      checks: [],
      playbooks: [],
      primary: { tests: [], checks: [] },
    };
  },
  async resolveCitation() {
    return {
      match: null,
      confidence: "none" as const,
      candidates: [],
      ambiguous: false,
      unmatched_segments: [],
    };
  },
  async taxonomy() { return []; },
};

// --- Mutable handles — reassign at startup time to connect a corpus --------

export const adapters = {
  regulation: emptyRegulation,
  test: emptyTest,
  check: emptyCheck,
  playbook: emptyPlaybook,
  source: emptySource,
  meta: emptyMeta,
};
