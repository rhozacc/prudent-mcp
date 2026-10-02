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
import { deriveTaxonomy } from "./areas.ts";
import { citationPartialClause, computeHoldings, idDocSegment } from "./holdings.ts";
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
  DocumentHolding,
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
/**
 * The numeric spine of a citation: the numbering, without the words around it.
 *
 * A trailing letter is part of the NUMBER, not a sub-point. The CRR is full of
 * inserted articles — 325bp, 104a, 449a — and dropping the suffix does not
 * merely lose precision, it silently renumbers the citation: "Article 325bp(1)"
 * reduced to ["1"], which then looks like a sub-point of anything numbered 1.
 * Single letters stay separate because that is what a bracketed point is
 * ("178(1)(a)" → 178, 1, a).
 */
const spineOf = (tokens: string[]): string[] =>
  tokens.filter((t) => /^\d+[a-z]{0,2}$/.test(t) || /^[a-z]$/.test(t));

/**
 * Did `spineOf` capture this citation's numbering, or throw part of it away?
 *
 * A structural id like "Section P3.TIV.C1b.S2b-3" carries numbering in tokens
 * the spine cannot represent, and reduces to ["3"]. That is fine for equality —
 * nothing else reduces to exactly ["3"] by accident — but fatal for CONTAINMENT,
 * where a short spine is a prefix of every longer one: the section would offer
 * itself as the provision containing "Chapter 3, paragraph 240(1)", which it
 * does not. Containment is only safe on citations whose numbering survived.
 */
const spineIsFaithful = (tokens: string[]): boolean =>
  tokens.every((t) => !/\d/.test(t) || /^\d+[a-z]{0,2}$/.test(t));

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
 * How an EU act is numbered in prose: kind, "(EU)", then serial/YEAR or
 * YEAR/serial. Defined ONCE, because the gate (`namedInstrument`) and the
 * mention scan (`instrumentMentions`) must agree on what a numbered act is, or
 * the refusal names an instrument the scan then cannot find. `guideline` is here
 * because ECB guidelines are numbered the same way ("Guideline (EU) 2017/697").
 */
const NUMBERED_ACT =
  /\b(regulation|directive|decision|guideline)\s*\((?:eu|ec|euratom)\)\s*(?:no\.?\s*)?(\d{1,4})\s*\/\s*(\d{1,4})\b/gi;

/** One key per instrument, whichever numbering era the citation is written in. */
function numberedActKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(NUMBERED_ACT)) {
    const kind = m[1];
    const first = m[2];
    const second = m[3];
    if (kind === undefined || first === undefined || second === undefined) continue;
    const [year, serial] = isYearNumber(first) ? [first, second] : [second, first];
    keys.push(`${kind.toLowerCase()}-${year}-${serial}`);
  }
  return keys;
}

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
  return numberedActKeys(text)[0] ?? null;
};

/**
 * Instruments a citation can name by DESCRIPTION rather than by number, and how
 * to recognise each in prose. The single table: `describedInstruments` reads it
 * to find what a citation names, `holdsKind` reads `held` to ask whether the
 * corpus has a document identifying as that kind.
 *
 * Conservative on purpose, and case-aware where the word is also a pronoun: RTS
 * and ITS match only in upper case ("its" is a pronoun in half the prose ever
 * written), so those two carry `caseSensitive`. A bare "delegated"/"implementing"
 * is not a description of an instrument; it has to be followed by what the act
 * is. And a descriptor that goes on to give the act's NUMBER in the form the
 * number gate reads ("Delegated Regulation (EU) 2022/439") is not a description
 * at all: that gate owns the citation, and re-reading it here would flip one the
 * corpus resolves today. A number the gate CANNOT read ("Delegated Regulation
 * 2022/439", no "(EU)") is still a description, and is declined as one: it is
 * the same unheld instrument, and falling through is how a same-numbered
 * provision of an unrelated document got offered for it.
 *
 * `held` lists token windows; a corpus document "identifies as" the kind when
 * its framework, document id or id segment contains one as a contiguous run.
 * Tokens, never substrings — "its" is inside "limits", "rts" inside "reports".
 */
const DESCRIBED_INSTRUMENTS: Array<{
  key: string;
  re: RegExp;
  held: string[][];
  caseSensitive?: boolean;
  /** Also an ordinary English word, so an all-capitals citation cannot be trusted to mean the acronym. */
  pronoun?: boolean;
}> = [
  { key: "rts", re: /\bRTS\b/g, held: [["rts"]], caseSensitive: true },
  {
    key: "rts",
    re: /\bregulatory\s+technical\s+standards?\b/gi,
    held: [["rts"], ["regulatory", "technical", "standard"], ["regulatory", "technical", "standards"]],
  },
  { key: "its", re: /\bITS\b/g, held: [["its"]], caseSensitive: true, pronoun: true },
  {
    key: "its",
    re: /\bimplementing\s+technical\s+standards?\b/gi,
    held: [["its"], ["implementing", "technical", "standard"], ["implementing", "technical", "standards"]],
  },
  {
    key: "delegated",
    re: new RegExp(`\\b(?:commission\\s+)?delegated\\s+(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["delegated"]],
  },
  {
    key: "implementing",
    re: new RegExp(`\\b(?:commission\\s+)?implementing\\s+(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["implementing"]],
  },
  ...(["regulation", "guideline", "decision", "recommendation"] as const).map((kind) => ({
    key: `ecb-${kind}`,
    re: new RegExp(`\\becb\\s+${kind}s?\\b`, "gi"),
    held: [["ecb", kind], ["ecb", `${kind}s`]],
  })),
  {
    key: "ecb-guideline",
    re: /\bguidelines?\s+of\s+the\s+(?:ecb|european\s+central\s+bank)\b/gi,
    held: [["ecb", "guideline"], ["ecb", "guidelines"]],
  },
];

interface DescribedInstrument {
  /** The citation's own words for it, quoted back. */
  quote: string;
  held: string[][];
  /** Written as a numbered identifier ("RTS/2016/03"), not as a description. */
  identifier: boolean;
}

/** Does the number gate read a number starting at the kind word that ends this match? */
function numberGateReads(text: string, start: number, matched: string): boolean {
  const sticky = new RegExp(NUMBERED_ACT.source, "iy");
  sticky.lastIndex = start + matched.search(/\S+$/);
  return sticky.test(text);
}

/**
 * Instruments the citation names by description, and the citation with those
 * words removed (so the rest can be scoped to a held document without "ECB" in
 * "ECB Regulation" being read as the held ECB guide).
 */
function describedInstruments(text: string): { found: DescribedInstrument[]; residual: string } {
  // An all-capitals citation has lost the case that tells ITS from a shouted
  // pronoun. RTS has no pronoun reading, so it stays recognised.
  const caseLost = !/[a-z]/.test(text);
  const found: DescribedInstrument[] = [];
  let residual = text;
  for (const { re, held, caseSensitive, pronoun } of DESCRIBED_INSTRUMENTS) {
    if (caseSensitive === true && caseLost && pronoun === true) continue;
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (numberGateReads(text, start, m[0])) continue;
      // "EBA/RTS/2016/03" is an identifier. It names its instrument by number, in
      // a shape the number gate does not read, so it is declined for what it is.
      const id = /^\s*\/\s*(\d{4})\s*\/\s*(\d{1,4})\b/.exec(text.slice(end));
      if (id !== null) {
        const lead = /(?:\b[A-Za-z]+\s*\/\s*)*$/.exec(text.slice(0, start))?.[0] ?? "";
        const whole = `${lead}${m[0]}${id[0]}`.replace(/\s+/g, "");
        if (!found.some((f) => f.quote === whole)) {
          found.push({
            quote: whole,
            held: [citationTokens(`${m[0]} ${id[1] ?? ""} ${id[2] ?? ""}`)],
            identifier: true,
          });
        }
        residual = residual.replace(`${lead}${m[0]}${id[0]}`, " ");
        continue;
      }
      // Quote from the descriptor to the end of its clause: "RTS on the IRB
      // assessment methodology" is what the caller wrote, not "RTS".
      const tail = (text.slice(start).split(/[,;()[\]]/)[0] ?? m[0]).trim();
      const quote = tail.length > 80 ? m[0] : tail;
      if (!found.some((f) => f.quote === quote)) found.push({ quote, held, identifier: false });
      residual = residual.replace(m[0], " ");
    }
  }
  return { found, residual };
}

/**
 * Does any document identify as this kind? A document does when its framework,
 * its document id, its id segment or "framework document_id" carries one of the
 * windows as a contiguous run of tokens. Exported because the eval that checks the
 * gate must decide "held" exactly as the gate does, or it reports a fatal defect
 * on a corpus the resolver handles correctly.
 */
export function holdsKind(
  regulations: Array<Pick<Regulation, "id" | "framework" | "document_id">>,
  held: string[][],
): boolean {
  return regulations.some((r) =>
    [r.framework, r.document_id, idDocSegment(r.id), `${r.framework} ${r.document_id}`].some((field) => {
      const tokens = citationTokens(field);
      return held.some((window) => windowAt(tokens, window) !== -1);
    }),
  );
}

/** The kinds a citation names by description, read from the one table. For the eval. */
export const describedKindWindows = (text: string): string[][] =>
  describedInstruments(text).found.flatMap((f) => f.held);

/**
 * Instruments this corpus does NOT hold, and what they are.
 *
 * Deliberately tiny, deliberately authored, and deliberately only about
 * IDENTITY — what kind of instrument it is and which provision empowers it.
 * Not what it requires: that is the text, the corpus does not have it, and
 * inventing it is the failure this whole file exists to prevent.
 *
 * It earns its place because the identity is the half a model gets wrong. The
 * corpus names Regulation (EU) 2021/930 in three served records and nowhere
 * says it is a regulatory technical standard, or that it was adopted under the
 * empowerment in CRR Article 181(3)(a) — so a model asked "is this the same
 * tier as the CRR?" has no served field to answer from, answers from memory,
 * and gets the hierarchy backwards. One line of curated fact, quotable against
 * a provision the corpus DOES hold, is the cheapest available fix.
 *
 * Every entry must name an empowering provision that this corpus serves, so the
 * claim is checkable rather than asserted.
 */
const EMPOWERMENTS: Record<string, { kind: string; empoweredBy?: string; visibleAt?: string }> = {
  "regulation-2021-930": {
    kind: "a regulatory technical standard — a Commission delegated act, not a legislative one",
    empoweredBy: "Article 181(3)(a) and Article 182(4)(a) of the CRR",
    visibleAt: "regulation://crr/article-181",
  },
  "regulation-2010-1093": {
    kind:
      "the Regulation establishing the EBA; its Article 16 is the basis on which every EBA " +
      "guideline in this corpus is issued, and the source of their comply-or-explain effect",
    visibleAt: "regulation://crr/article-181",
  },
};

/**
 * Which served records NAME a numbered EU instrument, keyed the same way
 * `namedInstrument` keys a citation.
 *
 * The existing "way out" in the refusal below was built from `cites[].framework`
 * — a field that only ever holds `crr` and `crd` — so it could never fire for a
 * numbered act, and every instrument the corpus mentions but does not hold got
 * the emptiest possible refusal at exactly the moment a model reaches for
 * memory. This scans the served text instead, which is where the mentions
 * actually are.
 *
 * Computed, never authored: a regex over text the corpus already serves.
 */
const mentionCache = new WeakMap<object, Map<string, string[]>>();
function instrumentMentions(regulations: Regulation[]): Map<string, string[]> {
  const cached = mentionCache.get(regulations);
  if (cached !== undefined) return cached;
  const index = new Map<string, string[]>();
  for (const r of regulations) {
    const seen = new Set<string>(numberedActKeys(r.text));
    for (const key of seen) {
      const at = index.get(key);
      if (at === undefined) index.set(key, [r.id]);
      else at.push(r.id);
    }
  }
  mentionCache.set(regulations, index);
  return index;
}

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
  const m = /^(regulation|directive|decision|guideline)-(\d{4})-(\d+)$/.exec(instrument);
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
 *       document that shares a number. Named by number, or by description
 *       ("the RTS on …", "an ECB Guideline") when no held document is that kind;
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
  // Optional so every existing caller keeps its behaviour: without holdings the
  // notes below are exactly what they were. With them, a decline on a partly
  // held document says the absence is the corpus's and not necessarily the law's.
  holdings?: DocumentHolding[],
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
    // A dead end that names the way out. Two ways out, in fact, and which one
    // is available decides whether the caller goes looking or guesses.
    //
    // (a) What the instrument IS. A refusal that says only "not held" invites
    //     the model to supply the instrument's identity from memory, and the
    //     identity — its tier, and the provision empowering it — is the part it
    //     gets wrong. Curated, checkable against a provision this corpus serves.
    // (b) Which served records NAME it. Scanned from the text rather than read
    //     off `cites[].framework`, which holds only `crr`/`crd` and so could
    //     never fire for a numbered act.
    const what = EMPOWERMENTS[instrument];
    // Both sources, unioned. `cites[].framework` is the only one that reaches a
    // named framework like `crr`; the text scan is the only one that reaches a
    // numbered act. Each is blind where the other sees.
    const byCite = regulations
      .filter((r) => (r.cites ?? []).some((c) => citationTokens(c.framework).join("") === instrument))
      .map((r) => r.id);
    const mentions = [
      ...new Set([...byCite, ...(instrumentMentions(regulations).get(instrument) ?? [])]),
    ];
    const shown = mentions.slice(0, 3);
    return none({
      coverage_note:
        `This corpus holds no ${instrumentLabel(instrument)}. Nothing was matched, rather than ` +
        "sourcing a same-numbered provision from another document. " +
        (what === undefined
          ? ""
          : `It is ${what.kind}` +
            (what.empoweredBy === undefined ? "" : `, adopted under ${what.empoweredBy}`) +
            ". " +
            (what.visibleAt === undefined
              ? ""
              : `That relationship is stated in served text at ${what.visibleAt}. `)) +
        (shown.length > 0
          ? `${mentions.length} served record(s) name it: ${shown.join(", ")}` +
            `${mentions.length > shown.length ? ", …" : ""} — open those for what this corpus ` +
            "says about it. Its own text is not here, so do not state its requirements from this corpus."
          : "Use get_corpus_info for the documents actually loaded."),
    });
  }

  // (0b) The descriptive gate. The same defence for an instrument named by what
  // it IS rather than by number: "Article 49(3) of the RTS on the IRB assessment
  // methodology" carries no number the gate above can read, so the instrument was
  // dropped and the bare "49(3)" went looking — and was offered paragraph 49 of
  // two unrelated guidelines as the containing provision. A decline is cheap; a
  // citation into the wrong body of law is the worst thing this server produces.
  //
  // Fires only for a description the corpus has no document identifying as, so a
  // corpus that does hold an RTS falls through to normal resolution. When the
  // citation ALSO names a held document, which of the two the "Article 49(3)"
  // belongs to is not something this resolver can know: decline, naming both.
  const described = describedInstruments(text);
  const unheld = described.found.filter((d) => !holdsKind(regulations, d.held));
  // Only when there is a provision number to place. Without one nothing can be
  // sourced from a same-numbered provision, and the "no provision number" note
  // below already says the instrument may be described without being held.
  const placeable =
    spineOf(citationTokens(described.residual).filter((t) => !STRUCTURAL.has(t))).length > 0;
  if (unheld.length > 0 && placeable) {
    const quoted = unheld.map((d) => `"${d.quote}"`).join(" and ");
    const identifiers = unheld.every((d) => d.identifier);
    const heldNames: string[] = [];
    if (instrument !== null) heldNames.push(instrumentLabel(instrument));
    const { docs: namedDocs } = scopeToDocument(
      citationTokens(described.residual),
      documentAliases(regulations),
    );
    // `crr` the instrument and `crr` the document are one thing named twice.
    for (const d of namedDocs ?? []) {
      if (!heldNames.some((n) => n.toLowerCase() === d.toLowerCase())) heldNames.push(d);
    }
    // An alias naming several documents is a framework ("EBA"), not a document:
    // listing its members would say the citation named each of them.
    const group = instrument === null && (namedDocs?.size ?? 0) > 1;
    const heldList = group
      ? `documents under a framework or name it shares (${heldNames.slice(0, 3).join(", ")}${heldNames.length > 3 ? ", …" : ""})`
      : `a document this corpus holds (${heldNames.slice(0, 3).join(", ")})`;
    // A number the number gate cannot read is not a reason to say "cite it by
    // number": the caller did, and the form is what was missing.
    const numberedDescription = !identifiers && unheld.some((d) => /\d\s*\/\s*\d/.test(d.quote));
    const wayOut =
      (identifiers
        ? ""
        : numberedDescription
          ? "Cite the instrument in full, kind then \"(EU)\" then its number (for example " +
            "\"Regulation (EU) YYYY/NNN\"), so the corpus can say whether it is held; "
          : "Cite the instrument by number so the corpus can say whether it is held; ") +
      (identifiers ? "Use" : "use") +
      " search_regulation with its name for what served records say about it, or " +
      "get_corpus_info for what is loaded. This note states nothing about what it requires.";
    const how = identifiers ? "an identifier" : "description";
    return none({
      coverage_note:
        heldNames.length === 0
          ? identifiers
            ? `"${text}" names an instrument by an identifier (${quoted}), and this corpus holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a " +
              `same-numbered provision from another document. ${wayOut}`
            : `"${text}" names an instrument by description (${quoted}), and this corpus holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a same-numbered " +
              `provision from another document. ${wayOut}`
          : `"${text}" names ${heldList} ` +
            `and also an instrument by ${how} (${quoted}) that it holds no document identified ` +
            "as, so which of the two the provision belongs to cannot be told. Nothing was matched, " +
            `rather than sourcing a same-numbered provision from either. Name one instrument per ` +
            `citation. ${wayOut}`,
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
  // Joined with a SEPARATOR, not concatenated. "Article 4(1)" and "Article 41"
  // tokenise to ["article","4","1"] and ["article","41"]; run together they are
  // both "article41", so a bracketed point silently became a different article
  // number — and on this corpus that offered EBA "Paragraph 41" as the answer
  // to a question about Article 4(1). Matching only ever gets stricter here.
  const nq = rest.join(" ");
  const exactHits = pool.filter((r) => bare(citationTokens(r.citation)).join(" ") === nq);
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
    (r.citation_aliases ?? []).some((a) => bare(citationTokens(a)).join(" ") === nq),
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
  if (spine.length === 0) {
    // A citation with no provision number in it — a document name on its own
    // ("EBA/GL/2019/03"), or prose naming an instrument by description ("the
    // RTS on economic downturn"). There is nothing to place, but a bare null is
    // the worst answer available: it is strictly LESS information than an
    // instrument the corpus does not hold gets, and it reads as "unknown
    // string" at the exact moment the caller is deciding whether to look
    // elsewhere or fill in from memory.
    //
    // Say which of the two it is, because they need opposite next steps.
    const named = docs === null ? [] : [...docs];
    return none({
      coverage_note:
        named.length > 0
          ? `"${text}" names a document this corpus holds (${named.join(", ")}) but no provision ` +
            "within it. Add a provision number, or use search_regulation to search inside it."
          : `"${text}" carries no provision number to resolve, and names no document this corpus ` +
            "holds. If it names an instrument, this corpus may still describe it without holding " +
            "it — search_regulation with its distinctive words, or get_corpus_info for what is loaded.",
    });
  }

  const recordSpine = (r: Regulation): string[] =>
    spineOf(bare(citationTokens(r.citation)).filter((t) => !STRUCTURAL.has(t)));

  const spineHits = pool.filter((r) => arraysEqual(recordSpine(r), spine));
  if (spineHits.length === 1) {
    return { ...none(), match: spineHits[0] ?? null, confidence: "segment" };
  }
  if (spineHits.length > 1) return ambiguousResolution(text, spineHits);

  // (iii) Narrower relatives. Reported, never returned as the match.
  // The partly-held clause rides on the two notes that say "this record is not
  // here" (iii and the final one). `match` and `confidence` are untouched: the
  // clause explains an absence, it never turns one into a hit. The container note
  // (iv) does not carry it - there the provision's text IS held, inside the
  // container, so nothing is missing to explain.
  const partial = citationPartialClause(holdings, docs);
  const withPartial = (note: string): string => (partial === null ? note : `${note} ${partial}`);

  const relatives = pool.filter((r) => startsWithTokens(recordSpine(r), spine));
  if (relatives.length > 0) {
    return none({
      candidates: relatives.slice(0, MAX_CANDIDATES).map(asCandidate),
      coverage_note: withPartial(
        `No record is "${text}" itself. The corpus holds ${relatives.length} narrower provision(s) ` +
          `under it${relatives.length > MAX_CANDIDATES ? ` (first ${MAX_CANDIDATES} listed)` : ""}; ` +
          "open one, or use get_regulation_tree on it for the whole subtree.",
      ),
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
  const containerTokens = rest.filter((t) => !STRUCTURAL.has(t));
  const containers = (spineIsFaithful(containerTokens) ? pool : [])
    .map((r) => ({ r, rs: recordSpine(r), rt: bare(citationTokens(r.citation)).filter((t) => !STRUCTURAL.has(t)) }))
    // Two guards, both against a SHORT spine claiming to contain a long one.
    // A record whose citation carries no numbers is a prefix of everything, so
    // a "Preamble" would contain every citation in the corpus. And a record
    // whose numbering the spine could not represent reduces to a fragment of
    // itself — "Section P3.TIV.C1b.S2b-3" becomes ["3"] and would offer itself
    // as the container of anything numbered 3.
    .filter(({ rs, rt }) => rs.length > 0 && spineIsFaithful(rt) && startsWithTokens(spine, rs))
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
      (partial === null ? "" : `${partial} `) +
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
    async search(query) {
      return rankedSearch(corpus.regulation, query, regulationSearchFields(query)).map(m => m.record);
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
      // Holdings likewise: a stored block cannot know what the registry now
      // declares, and its `coverage` list stays exactly as authored.
      const holdings = computeHoldings(corpus.regulation, corpus.sources);
      if (corpus.corpus_info) {
        return {
          ...corpus.corpus_info,
          counts: { ...corpus.corpus_info.counts, source: corpus.sources.length },
          stale_sources,
          holdings,
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
