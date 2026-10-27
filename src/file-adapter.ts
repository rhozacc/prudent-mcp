import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  AsOfResolution,
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  SourceAdapter,
  TestAdapter,
} from "./adapters.ts";
import { resolveCitationDetailed } from "./citation/resolve.ts";
import { computeHoldings } from "./holdings.ts";
import { pendingChangeSummaries } from "./pending.ts";
import { computeReferrers } from "./referrers.ts";
import {
  checkSearchFields,
  playbookSearchFields,
  rankedRecords,
  rankedSearch,
  regulationRanking,
  regulationSearchFields,
  testSearchFields,
} from "./search.ts";
import {
  CheckSchema,
  CorpusInfoSchema,
  PlaybookSchema,
  RegulationSchema,
  SourceSchema,
  TestSchema,
  TopicsSchema,
  regulationIdSchema,
} from "./schema.ts";
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
  Source,
  SourceId,
  Test,
  TestId,
} from "./schema.ts";
import { staleSourceIds } from "./validate.ts";

// The citation resolver lives in ./citation/; these are the names this module
// has always exported, kept so `prudent-mcp/file-adapter` stays source-compatible.
export { describedKindWindows, holdsKind } from "./citation/described.ts";
export type { PointCheck } from "./citation/points.ts";
export { textCarriesPoint } from "./citation/points.ts";
export { resolveCitationDetailed, resolveCitationIn } from "./citation/resolve.ts";

// --- Corpus file schema -------------------------------------------------------

/**
 * A past (or current-boundary) version of a regulation record, keyed by the
 * ISO date it entered into force. Entries live under the corpus file's
 * optional `regulation_history` key and power `get(id, asOf)`.
 */
export const RegulationHistoryEntrySchema = z.object({
  id: regulationIdSchema,
  effective_from: z.string().date(),
  record: RegulationSchema,
});
export type RegulationHistoryEntry = z.infer<typeof RegulationHistoryEntrySchema>;

export const CorpusFileSchema = z.object({
  regulation: z.array(RegulationSchema).default([]),
  tests: z.array(TestSchema).default([]),
  checks: z.array(CheckSchema).default([]),
  playbooks: z.array(PlaybookSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  // Optional per-regulation version history for as-of resolution. Entries are
  // PAST versions with the date each entered into force; a corpus that wants
  // the CURRENT version selectable under as_of includes one entry whose
  // `record` is the current text with its effective boundary (the in-memory
  // demo follows the same convention). loadCorpusFile defaults this to [].
  regulation_history: z.array(RegulationHistoryEntrySchema).default([]),
  corpus_info: CorpusInfoSchema.optional(),
  // Abbreviation -> the phrases the texts use for it ("rds": ["reference data
  // set"]). Data, not code, so this public server stays corpus-agnostic.
  glossary: z.record(z.array(z.string())).optional(),
  // Areas -> topics, authored in the factory (TopicsSchema): what the playbooks were compiled from.
  topics: TopicsSchema.optional(),
});

// `regulation_history` stays optional on the exported TYPE (parse always
// materializes it) so existing callers constructing CorpusFile literals —
// e.g. the dashboard's corpus merger — keep compiling unchanged.
export type CorpusFile = Omit<z.infer<typeof CorpusFileSchema>, "regulation_history"> & {
  regulation_history?: RegulationHistoryEntry[];
};

export function loadCorpusFile(path: string): CorpusFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return CorpusFileSchema.parse(raw);
}

// --- File-backed adapters -------------------------------------------------

export function createFileAdapters(corpus: CorpusFile): {
  regulation: RegulationAdapter;
  test: TestAdapter;
  check: CheckAdapter;
  playbook: PlaybookAdapter;
  source: SourceAdapter;
  meta: MetaAdapter;
} {
  const regMap = new Map<RegulationId, Regulation>(corpus.regulation.map(r => [r.id, r]));
  const testMap = new Map<TestId, Test>(corpus.tests.map(t => [t.id, t]));
  const checkMap = new Map<CheckId, Check>(corpus.checks.map(c => [c.id, c]));
  const playbookMap = new Map<PlaybookId, Playbook>(corpus.playbooks.map(p => [p.id, p]));
  const sourceMap = new Map<SourceId, Source>(corpus.sources.map(s => [s.id, s]));

  // Version history per regulation id, sorted ascending by effective_from
  // (lexicographic ISO-date compare — the repo-wide convention).
  const historyMap = new Map<RegulationId, RegulationHistoryEntry[]>();
  for (const entry of corpus.regulation_history ?? []) {
    const existing = historyMap.get(entry.id);
    if (existing === undefined) historyMap.set(entry.id, [entry]);
    else existing.push(entry);
  }
  for (const entries of historyMap.values()) {
    entries.sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0));
  }

  // Earliest date each document is known to have existed, from the registry.
  //
  // This is what makes `as_of` honest on a corpus carrying no version history.
  // Without it the adapter served the CURRENT text for any past date, with no
  // notice — so asking for a 2019 guideline as it stood in 2016 returned the
  // 2019 text, silently, three years wide. The tool's own description promises
  // the opposite ("never current text as historical"), and a validator's
  // commonest question is what applied at the date of an approval.
  //
  // `published` is the honest bound rather than `effective_from`: a document
  // that exists but does not yet apply is a different answer from one that does
  // not exist, and only the first is something this corpus can speak to.
  const documentFirstKnown = new Map<string, string>();
  for (const s of corpus.sources) {
    const at = s.published ?? s.effective_from;
    if (at === undefined) continue;
    const prev = documentFirstKnown.get(s.document_id);
    if (prev === undefined || at < prev) documentFirstKnown.set(s.document_id, at);
  }

  // As-of semantics (mirrors the in-memory demo's HISTORICAL_REGULATIONS
  // selection logic exactly):
  //   - no asOf                  → current record (or null if unknown);
  //   - asOf, no history for id  → current record — the only version the
  //     corpus knows; corpora without history keep their pre-history behavior;
  //   - asOf, history present    → the last entry with effective_from <= asOf
  //     (entries sorted ascending). The current version is selectable only
  //     when the corpus includes a history entry carrying it; if asOf
  //     predates every known version the answer is null, never current text
  //     masquerading as historical.
  //
  // This is the ONE implementation, and it reports the basis alongside the
  // record. `get` below delegates to it rather than repeating the rules: the
  // basis is what tells a caller whether a hit is the text in force on the date
  // or only the best text the corpus has, and two copies of the selection logic
  // could disagree about which of those it served.
  const resolveAsOf = async (id: RegulationId, asOf: string): Promise<AsOfResolution> => {
    const history = historyMap.get(id);
    if (history === undefined) {
      const current = regMap.get(id) ?? null;
      if (current === null) return { record: null };
      // No per-provision history, so the current text is the only version
      // this corpus knows — but "the only version I know" is not "the version
      // in force then". If the asked-for date predates the document itself,
      // the honest answer is nothing, not today's text wearing a past date.
      const firstKnown = documentFirstKnown.get(current.document_id);
      if (firstKnown !== undefined && asOf < firstKnown) return { record: null };
      // The document existed, so the current text is served — and it is the
      // `current` basis that lets the tool layer say it is not the text of
      // that date. Before this was reported, a validator asking what applied
      // at an approval date was handed today's text indistinguishable from a
      // historical version.
      return { record: current, basis: "current" };
    }
    let chosen: Regulation | null = null;
    for (const entry of history) {
      if (entry.effective_from <= asOf) chosen = entry.record;
      else break;
    }
    return chosen === null ? { record: null } : { record: chosen, basis: "history" };
  };

  const regulation: RegulationAdapter = {
    async search(query, options) {
      const ranking = regulationRanking({ scope: options?.scope, glossary: corpus.glossary });
      return rankedRecords(corpus.regulation, query, regulationSearchFields(query), undefined, ranking);
    },
    async get(id, asOf) {
      if (asOf === undefined) return regMap.get(id) ?? null;
      return (await resolveAsOf(id, asOf)).record;
    },
    resolveAsOf,
    async list() { return corpus.regulation; },
  };

  const test: TestAdapter = {
    async search(query) {
      return rankedRecords(corpus.tests, query, testSearchFields, undefined, { glossary: corpus.glossary });
    },
    async get(id) { return testMap.get(id) ?? null; },
    async list() { return corpus.tests; },
  };

  const check: CheckAdapter = {
    async search(query) {
      return rankedRecords(corpus.checks, query, checkSearchFields, undefined, { glossary: corpus.glossary });
    },
    async get(id) { return checkMap.get(id) ?? null; },
    async list() { return corpus.checks; },
  };

  const playbook: PlaybookAdapter = {
    async search(query) {
      return rankedRecords(corpus.playbooks, query, playbookSearchFields, undefined, { glossary: corpus.glossary });
    },
    async get(id) { return playbookMap.get(id) ?? null; },
    async list() { return corpus.playbooks; },
  };

  const source: SourceAdapter = {
    async list(filter) {
      const status = filter?.status;
      return status === undefined ? corpus.sources : corpus.sources.filter(s => s.status === status);
    },
    async get(id) { return sourceMap.get(id) ?? null; },
  };

  const meta: MetaAdapter = {
    async info(): Promise<CorpusInfo> {
      // Source count and staleness are computed at serve time even when the
      // file ships a corpus_info block — stored currency data is stale by definition.
      const stale_sources = staleSourceIds(corpus.sources);
      // Holdings likewise: a stored block cannot know what the registry now
      // declares, and its `coverage` list stays exactly as authored.
      const holdings = computeHoldings(corpus.regulation, corpus.sources);
      // Open pending changes likewise (src/pending.ts): derived from the registry and
      // today's date, so a stored block can never go on saying "upcoming". Absent
      // unless some source declares the field.
      const pending = pendingChangeSummaries(corpus.sources);
      const pendingKey = pending === undefined ? {} : { pending_changes: pending };
      if (corpus.corpus_info) {
        return {
          ...corpus.corpus_info,
          counts: { ...corpus.corpus_info.counts, source: corpus.sources.length },
          stale_sources,
          holdings,
          ...pendingKey,
        };
      }
      return {
        last_updated: new Date().toISOString(),
        counts: {
          regulation: corpus.regulation.length,
          test: corpus.tests.length,
          check: corpus.checks.length,
          playbook: corpus.playbooks.length,
          source: corpus.sources.length,
        },
        coverage: [...new Set(corpus.regulation.map(r => r.framework.toUpperCase()))],
        stale_sources,
        holdings,
        ...pendingKey,
      };
    },
    async referrers(id: string): Promise<Referrers> {
      return computeReferrers(
        {
          regulation: corpus.regulation,
          tests: corpus.tests,
          checks: corpus.checks,
          playbooks: corpus.playbooks,
        },
        id,
      );
    },
    async resolveCitation(text: string): Promise<CitationResolution> {
      return resolveCitationDetailed(corpus.regulation, text, computeHoldings(corpus.regulation, corpus.sources));
    },
    async topics() {
      return corpus.topics;
    },
    async glossary() {
      return corpus.glossary;
    },
  };

  return { regulation, test, check, playbook, source, meta };
}
