import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  SourceAdapter,
  TestAdapter,
} from "./adapters.ts";
import { deriveTaxonomy } from "./areas.ts";
import { computeReferrers } from "./referrers.ts";
import {
  checkSearchFields,
  playbookSearchFields,
  rankedSearch,
  regulationSearchFields,
  testSearchFields,
} from "./search.ts";
import {
  CheckSchema,
  CorpusInfoSchema,
  PlaybookSchema,
  RegulationSchema,
  ReviewAreaSchema,
  SourceSchema,
  TestSchema,
  regulationIdSchema,
} from "./schema.ts";
import type {
  Check,
  CheckId,
  CitationCandidate,
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
  Test,
  TestId,
} from "./schema.ts";
import { staleSourceIds } from "./validate.ts";

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
  taxonomy: z.array(ReviewAreaSchema).default([]),
  // Optional per-regulation version history for as-of resolution. Entries are
  // PAST versions with the date each entered into force; a corpus that wants
  // the CURRENT version selectable under as_of includes one entry whose
  // `record` is the current text with its effective boundary (the in-memory
  // demo follows the same convention). loadCorpusFile defaults this to [].
  regulation_history: z.array(RegulationHistoryEntrySchema).default([]),
  corpus_info: CorpusInfoSchema.optional(),
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

// --- Citation resolution --------------------------------------------------

// Common citation abbreviations, expanded during normalization so
// "Art. 178(1)(a)" and "CRR Article 178(1)(a)" normalize into comparable forms.
const CITATION_EXPANSIONS: Record<string, string> = {
  art: "article",
  arts: "articles",
  par: "paragraph",
  para: "paragraph",
  paras: "paragraphs",
  gl: "guidelines",
};

function citationTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => CITATION_EXPANSIONS[t] ?? t);
}

/**
 * Structural words: they say what KIND of node a citation names, not which one.
 * Dropped when comparing the numeric spine so "Chapter 5, paragraph 12",
 * "chapter 5 para 12" and "5.12" compare equal.
 */
const STRUCTURAL = new Set([
  "article", "articles", "paragraph", "paragraphs", "point", "points", "section", "sections",
  "chapter", "chapters", "annex", "annexes", "subparagraph", "letter", "recital", "part", "title",
  "guidelines", "guideline", "guide", "no", "of", "the", "in", "and", "on", "at", "under",
]);

/**
 * The numeric spine of a citation: the article/paragraph/point numbers and
 * single-letter points, in order. "Chapter 5, paragraph 12" gives ["5","12"];
 * "Art. 178(1)(a)" gives ["178","1","a"].
 *
 * Single letters are kept because a legal point IS a single letter; that is
 * also why no length-based filtering is used anywhere in this file.
 */
const spineOf = (tokens: string[]): string[] =>
  tokens.filter((t) => /^\d+$/.test(t) || /^[a-z]$/.test(t));

/** First path segment of a regulation id — the document, not the framework. */
const idDocSegment = (id: RegulationId): string =>
  id.slice("regulation://".length).split("/")[0] ?? "";

const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const startsWithTokens = (haystack: string[], prefix: string[]): boolean =>
  prefix.length < haystack.length && prefix.every((v, i) => v === haystack[i]);

/** Index of `window` as a contiguous run in `tokens`, or -1. */
function windowAt(tokens: string[], window: string[]): number {
  if (window.length === 0 || window.length > tokens.length) return -1;
  for (let i = 0; i + window.length <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < window.length; j++) {
      if (tokens[i + j] !== window[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

/**
 * Document aliases mapped to the documents they name.
 *
 * A citation identifies its document in whatever spelling the writer knows:
 * the framework ("eba"), the document id ("eba-gl-2017-16"), or the corpus's
 * own short id segment ("gl-2017-16", "egim"). All three are indexed, and an
 * alias naming several documents (a bare framework) narrows the pool to those
 * several rather than picking one.
 */
function documentAliases(
  regulations: Regulation[],
): Map<string, { tokens: string[]; docs: Set<string> }> {
  const index = new Map<string, { tokens: string[]; docs: Set<string> }>();
  const add = (raw: string, docId: string): void => {
    const tokens = citationTokens(raw);
    if (tokens.length === 0) return;
    const key = tokens.join(" ");
    const slot = index.get(key);
    if (slot === undefined) index.set(key, { tokens, docs: new Set([docId]) });
    else slot.docs.add(docId);
  };
  for (const r of regulations) {
    add(r.framework, r.document_id);
    add(r.document_id, r.document_id);
    add(idDocSegment(r.id), r.document_id);
    add(`${r.framework} ${r.document_id}`, r.document_id);
  }
  return index;
}

/**
 * The document(s) a citation names, and the tokens that named them.
 *
 * The window is reported so it can be REMOVED before the spine is taken:
 * "EBA GL 2017/16 paragraph 78" carries the numbers 2017 and 16, which belong
 * to the document's name and not to the provision. Left in, they make the
 * spine ["2017","16","78"], which matches nothing — the resolver then falls
 * through to a looser rule, and looser rules are what fabricate.
 */
function scopeToDocument(
  tokens: string[],
  index: Map<string, { tokens: string[]; docs: Set<string> }>,
): { docs: Set<string> | null; rest: string[] } {
  let bestTokens: string[] | null = null;
  let bestDocs: Set<string> | null = null;
  let bestAt = -1;
  for (const { tokens: alias, docs } of index.values()) {
    const at = windowAt(tokens, alias);
    if (at === -1) continue;
    // Longest alias wins; among equals, the one naming fewest documents.
    const better =
      bestTokens === null ||
      alias.length > bestTokens.length ||
      (alias.length === bestTokens.length && docs.size < (bestDocs?.size ?? Number.POSITIVE_INFINITY));
    if (better) {
      bestTokens = alias;
      bestDocs = docs;
      bestAt = at;
    }
  }
  if (bestTokens === null || bestDocs === null) return { docs: null, rest: tokens };
  return {
    docs: bestDocs,
    rest: [...tokens.slice(0, bestAt), ...tokens.slice(bestAt + bestTokens.length)],
  };
}

/** Instruments a citation can name, and how to recognise them in prose. */
const INSTRUMENT_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "crr", re: /\bcrr\b|regulation\s*\(eu\)\s*(no\.?\s*)?575\s*\/\s*2013|\b575\s*\/\s*2013\b/i },
  { key: "crd", re: /\bcrd\s*(iv|v)?\b|directive\s*2013\s*\/\s*36/i },
];

/** Is this the YEAR half of an EU act number, rather than the serial? */
const isYearNumber = (s: string): boolean => /^(?:19|20)\d{2}$/.test(s);

/**
 * A numbered EU instrument the citation names, in either numbering era.
 *
 * EU acts were numbered serial/YEAR until 2015 ("Regulation (EU) No 575/2013")
 * and YEAR/serial from 2015 on, with the "No" dropped ("Regulation (EU)
 * 2021/930"). The old pattern required a FOUR-DIGIT second number, so every act
 * adopted since 2015 with a serial under 1000 fell straight through the gate —
 * nine of the twenty-seven numbered instruments this corpus's own text names,
 * including the downturn RTS and the GDPR-shaped 2016/679.
 *
 * Falling through matters more than it sounds. The gate is the defence against
 * sourcing a same-numbered provision from a document the caller did not name;
 * skipping it sent the citation into the numeric spine rules, which is why
 * asking for 2021/930 came back "nothing in this corpus is numbered 2021.930" —
 * a malformed-citation shape, when the truth is a coverage boundary.
 */
const namedInstrument = (text: string): string | null => {
  for (const { key, re } of INSTRUMENT_PATTERNS) if (re.test(text)) return key;
  const m =
    /\b(regulation|directive|decision)\s*\((?:eu|ec|euratom)\)\s*(?:no\.?\s*)?(\d{1,4})\s*\/\s*(\d{1,4})\b/i.exec(
      text,
    );
  if (m === null) return null;
  const kind = m[1];
  const first = m[2];
  const second = m[3];
  if (kind === undefined || first === undefined || second === undefined) return null;
  // Normalise to kind-YEAR-serial whichever era the citation is written in, so
  // one instrument has one key however it was spelled.
  const [year, serial] = isYearNumber(first) ? [first, second] : [second, first];
  return `${kind.toLowerCase()}-${year}-${serial}`;
};

/** Does any served record belong to the instrument this citation names? */
function corpusHolds(regulations: Regulation[], instrument: string): boolean {
  const needle = instrument.replace(/[^a-z0-9]/g, "");
  return regulations.some((r) => {
    const hay = `${r.framework}${r.document_id}${idDocSegment(r.id)}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return hay.includes(needle);
  });
}

/** How many candidates a declined resolution is allowed to carry. */
const MAX_CANDIDATES = 10;

const asCandidate = (r: Regulation): CitationCandidate => ({
  id: r.id,
  citation: r.citation,
  document_id: r.document_id,
});

/**
 * Instrument key rendered the way a reader would write it.
 *
 * The era decides the "No": post-2015 acts are cited "Regulation (EU) 2021/930"
 * and writing "Regulation (EU) No 2021/930" is a wrong citation of a real act —
 * not a thing to emit from a refusal whose whole purpose is not guessing.
 */
const instrumentLabel = (instrument: string): string => {
  const m = /^(regulation|directive|decision)-(\d{4})-(\d+)$/.exec(instrument);
  if (m === null) return instrument.toUpperCase();
  const kind = `${(m[1] ?? "").charAt(0).toUpperCase()}${(m[1] ?? "").slice(1)}`;
  const year = m[2] ?? "";
  const serial = m[3] ?? "";
  return Number(year) >= 2015
    ? `${kind} (EU) ${year}/${serial}`
    : `${kind} (EU) No ${serial}/${year}`;
};

/** Several equally good matches: report them all, choose none. */
function ambiguousResolution(text: string, hits: Regulation[]): CitationResolution {
  const docs = new Set(hits.map((r) => r.document_id));
  return {
    match: null,
    confidence: "none",
    ambiguous: true,
    candidates: hits.slice(0, MAX_CANDIDATES).map(asCandidate),
    unmatched_segments: [],
    coverage_note:
      `"${text}" matches ${hits.length} records across ${docs.size} document(s)` +
      `${hits.length > MAX_CANDIDATES ? ` (first ${MAX_CANDIDATES} listed)` : ""}. ` +
      "Name the document to disambiguate, or open one of the candidates.",
  };
}

/**
 * Loose citation string to a resolution that can say "I don't know".
 *
 * The previous version could not. It matched normalized citations by
 * containment in either direction, so "Article 1218" contained "Article 121"
 * and resolved to it; and it fell back to a suffix match on id segments. With
 * no check on the instrument a citation named, "Article 178 of the CRR" landed
 * on whatever document happened to have a paragraph 178. Every one of those
 * came back as a confident, fully-populated match with no way to tell it from
 * a real hit — which for a regulatory tool is the worst failure available,
 * because the consumer presents it to a reader as a citation.
 *
 * Matching now, in order, and nothing below it:
 *
 *   (0) instrument gate — a citation naming an instrument the corpus does not
 *       hold resolves to null with a coverage note, never into another
 *       document that shares a number;
 *   (i) exact normalized-citation equality;
 *   (ii) exact equality of the numeric SPINE (article/paragraph/point numbers,
 *        structural words dropped), scoped to the document the citation names.
 *        Exact: 1218 is not 121, and 178 is not 178(1)(a);
 *   (iii) narrower relatives — records whose spine strictly extends the
 *        citation's. Returned as candidates with match still null, because
 *        "the corpus holds 178(1)(a) and 178(1)(b) but no Article 178" is
 *        useful and "Article 178 is 178(1)(a)" is false.
 *
 * Several equally good matches make the result ambiguous — candidates are
 * returned and `match` stays null, because picking one silently is the bug.
 */
export function resolveCitationDetailed(
  regulations: Regulation[],
  text: string,
): CitationResolution {
  const none = (extra: Partial<CitationResolution> = {}): CitationResolution => ({
    match: null,
    confidence: "none",
    candidates: [],
    ambiguous: false,
    unmatched_segments: [],
    ...extra,
  });

  const queryTokens = citationTokens(text);
  if (queryTokens.length === 0) return none();

  // (0) The instrument gate. Checked first: a wrong instrument is not a near
  // miss, it is a different body of law.
  const instrument = namedInstrument(text);
  if (instrument !== null && !corpusHolds(regulations, instrument)) {
    // A dead end that names the way out. The corpus does not hold the CRR, but
    // most of what it does hold elaborates it — so the records CITING the
    // instrument are the answer to what was almost certainly being asked.
    const citing = regulations.filter((r) =>
      (r.cites ?? []).some((c) => citationTokens(c.framework).join("") === instrument),
    ).length;
    return none({
      coverage_note:
        `This corpus holds no ${instrumentLabel(instrument)}. Nothing was matched, rather than ` +
        "sourcing a same-numbered provision from another document. " +
        (citing > 0
          ? `${citing} records do cite it — search_regulation with the provision number, or ` +
            "get_referrers on one of those records, to reach what elaborates it."
          : "Use get_corpus_info for the documents actually loaded."),
    });
  }

  // The document a citation names is stripped from BOTH sides before anything
  // is compared: a record's own citation may repeat it ("CRR Article 180"), a
  // query may omit it ("Art. 180"), and its numbers ("2017/16") are not the
  // provision's.
  const index = documentAliases(regulations);
  const { docs, rest } = scopeToDocument(queryTokens, index);
  const pool = docs === null ? regulations : regulations.filter((r) => docs.has(r.document_id));
  const bare = (tokens: string[]): string[] => scopeToDocument(tokens, index).rest;

  // (i) Exact equality of the whole citation, structural words included — so
  // "paragraph 78" does not match a record that says "Article 78".
  const nq = rest.join("");
  const exactHits = pool.filter((r) => bare(citationTokens(r.citation)).join("") === nq);
  if (exactHits.length === 1) {
    return { ...none(), match: exactHits[0] ?? null, confidence: "exact" };
  }
  if (exactHits.length > 1) return ambiguousResolution(text, exactHits);

  // (i-alias) The same equality against a record's declared aliases.
  //
  // Kept as its own pass, and its own confidence level, rather than folded into
  // (i): the caller asked for a label this record does not carry. EBA
  // guidelines number PARAGRAPHS, so "Article 178" is a common way to cite one
  // and also a real CRR article — the alias makes the loose spelling resolvable
  // without letting it be reported as the record's citation.
  const aliasHits = pool.filter((r) =>
    (r.citation_aliases ?? []).some((a) => bare(citationTokens(a)).join("") === nq),
  );
  if (aliasHits.length === 1) {
    const hit = aliasHits[0];
    return {
      ...none(),
      match: hit ?? null,
      confidence: "alias",
      coverage_note:
        hit === undefined
          ? undefined
          : `Matched an alias. This record's own citation is "${hit.citation}" — quote that, ` +
            `not "${text}".`,
    };
  }
  if (aliasHits.length > 1) return ambiguousResolution(text, aliasHits);

  // (ii) Spine equality: the numbers alone, however the citation spells the
  // structure around them.
  const spine = spineOf(rest.filter((t) => !STRUCTURAL.has(t)));
  if (spine.length === 0) return none();

  const recordSpine = (r: Regulation): string[] =>
    spineOf(bare(citationTokens(r.citation)).filter((t) => !STRUCTURAL.has(t)));

  const spineHits = pool.filter((r) => arraysEqual(recordSpine(r), spine));
  if (spineHits.length === 1) {
    return { ...none(), match: spineHits[0] ?? null, confidence: "segment" };
  }
  if (spineHits.length > 1) return ambiguousResolution(text, spineHits);

  // (iii) Narrower relatives. Reported, never returned as the match.
  const relatives = pool.filter((r) => startsWithTokens(recordSpine(r), spine));
  if (relatives.length > 0) {
    return none({
      candidates: relatives.slice(0, MAX_CANDIDATES).map(asCandidate),
      coverage_note:
        `No record is "${text}" itself. The corpus holds ${relatives.length} narrower provision(s) ` +
        `under it${relatives.length > MAX_CANDIDATES ? ` (first ${MAX_CANDIDATES} listed)` : ""}; ` +
        "open one, or use get_regulation_tree on it for the whole subtree.",
    });
  }

  // (iv) The CONTAINING provision — the mirror of (iii), and the half that was
  // missing. Rule (iii) answers "the corpus holds provisions under the one you
  // named"; this answers "the corpus holds the record yours sits inside".
  //
  // It matters because of how the corpus is shaped rather than how citations
  // are written: the CRR is stored at whole-article granularity — not one of
  // its 160 records carries a bracketed citation — while 86% of the
  // cross-references the corpus makes about itself are bracketed sub-article
  // points. So "Article 181(1)(b) of the CRR" was a bare miss reading "nothing
  // in this corpus is numbered 181.1.b", for a provision served in full, whose
  // text contains point (b) verbatim.
  //
  // Still a decline: `match` stays null and `confidence` stays "none". Matching
  // is not being loosened — the container is reported as a candidate, exactly
  // as a narrower relative is. Token-level prefix, so 1218 still cannot claim
  // to contain 121.
  const containers = pool
    .map((r) => ({ r, rs: recordSpine(r) }))
    // A record whose citation carries no numbers is a prefix of everything;
    // without this guard a "Preamble" would claim to contain every citation.
    .filter(({ rs }) => rs.length > 0 && startsWithTokens(spine, rs))
    // Narrowest first: the most specific container is the most useful one.
    .sort((a, b) => b.rs.length - a.rs.length);
  if (containers.length > 0) {
    const best = containers[0]!;
    const inside = spine.slice(best.rs.length).join(".");
    return none({
      unmatched_segments: spine,
      candidates: containers.slice(0, MAX_CANDIDATES).map(({ r }) => asCandidate(r)),
      coverage_note:
        `No record is "${text}" itself — this corpus does not address provisions at that ` +
        `granularity. It holds the provision containing it: "${best.r.citation}" ` +
        `(${best.r.id}), whose text carries point ${inside}. Open it and quote the point from ` +
        "its text rather than citing this resolution.",
    });
  }

  // Nothing placed the citation. Say which parts went unmatched, so a dropped
  // point is visible rather than silently ignored.
  return none({
    unmatched_segments: spine,
    coverage_note:
      `Nothing in this corpus is numbered ${spine.join(".")}${docs === null ? "" : " in the document named"}. ` +
      "Try search_regulation with the citation's key words.",
  });
}

/** Back-compatible shim: the match alone, or null. */
export function resolveCitationIn(regulations: Regulation[], text: string): Regulation | null {
  return resolveCitationDetailed(regulations, text).match;
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

  const regulation: RegulationAdapter = {
    async search(query) {
      return rankedSearch(corpus.regulation, query, regulationSearchFields(query)).map(m => m.record);
    },
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
    async get(id, asOf) {
      const current = regMap.get(id) ?? null;
      if (asOf === undefined) return current;
      const history = historyMap.get(id);
      if (history === undefined) return current;
      let chosen: Regulation | null = null;
      for (const entry of history) {
        if (entry.effective_from <= asOf) chosen = entry.record;
        else break;
      }
      return chosen;
    },
    async list() { return corpus.regulation; },
  };

  const test: TestAdapter = {
    async search(query) {
      return rankedSearch(corpus.tests, query, testSearchFields).map(m => m.record);
    },
    async get(id) { return testMap.get(id) ?? null; },
    async list() { return corpus.tests; },
  };

  const check: CheckAdapter = {
    async search(query) {
      return rankedSearch(corpus.checks, query, checkSearchFields).map(m => m.record);
    },
    async get(id) { return checkMap.get(id) ?? null; },
    async list() { return corpus.checks; },
  };

  const playbook: PlaybookAdapter = {
    async search(query) {
      return rankedSearch(corpus.playbooks, query, playbookSearchFields).map(m => m.record);
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
      if (corpus.corpus_info) {
        return {
          ...corpus.corpus_info,
          counts: { ...corpus.corpus_info.counts, source: corpus.sources.length },
          stale_sources,
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
      return resolveCitationDetailed(corpus.regulation, text);
    },
    async taxonomy(): Promise<ReviewArea[]> {
      // An authored taxonomy wins: it can name areas the corpus does not cover
      // yet, which a derived one cannot. With none, derive from the playbooks
      // rather than serving [] — an empty list here takes list_review_areas
      // AND get_area_overview out of service, and those are the entry path.
      return corpus.taxonomy.length > 0 ? corpus.taxonomy : deriveTaxonomy(corpus.playbooks);
    },
  };

  return { regulation, test, check, playbook, source, meta };
}
