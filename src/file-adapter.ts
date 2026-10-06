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
import { pendingChangeSummaries } from "./pending.ts";
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

// Areas -> topics, authored in the factory and carried in the corpus file. The
// server reads nothing from it yet (the 1.0 playbook tools will), so it is
// validated loosely and passed through: an unknown key on an area or a topic
// is kept, not stripped.
export const CorpusTopicSchema = z
  .object({ id: z.string(), title: z.string(), scope: z.string().optional() })
  .passthrough();
export const CorpusTopicsSchema = z
  .object({
    areas: z.array(
      z.object({ id: z.string(), title: z.string(), topics: z.array(CorpusTopicSchema) }).passthrough(),
    ),
  })
  .passthrough();

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
  // Abbreviation -> the phrases the texts use for it ("rds": ["reference data
  // set"]). Data, not code, so this public server stays corpus-agnostic.
  glossary: z.record(z.array(z.string())).optional(),
  topics: CorpusTopicsSchema.optional(),
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
 * The grammar of a citation that says nothing about WHICH provision: "Article 3 of
 * the CRR" and "Article 3" name the same article. Dropped from both sides in the
 * pass that compares a citation with a record's own once the exact pass has found
 * nothing (`coreHits`), so a connective left behind by the document's name ("of
 * the") cannot make an exact citation look like a different one - which is how
 * "Article 3 of the CRR" came back ambiguous, tied on the numeric spine with a
 * record whose citation reduces to the same number, while "Article 3 CRR" was exact.
 * Kind words ("article", "paragraph") stay: "paragraph 78" is not "article 78". So
 * does every single letter, including "a": point (a) is a point, not the English
 * article.
 */
const CONNECTIVES = new Set(["of", "the", "in", "on", "at", "and", "under", "from", "an", "to", "for", "with", "by"]);
const withoutConnectives = (tokens: string[]): string[] => tokens.filter((t) => !CONNECTIVES.has(t));

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

// --- Does a container's text carry the point a citation names? -------------

/** `yes`: found where it should be. `no`: the text numbers this way and the marker is not there. `unknown`: cannot be judged. */
export type PointCheck = "yes" | "no" | "unknown";

interface Mark {
  value: string;
  start: number;
  end: number;
}

type MarkKind = "num" | "alpha";
type MarkStyle = "dot" | "paren" | "rparen";

// A marker only counts where a list item can start: at the head of the text or
// of a line, or after the sentence/clause end that precedes the next limb
// ("...; (b)", "...; and (c)", "...: (a)"). "points (a) and (b) of paragraph 1"
// is a reference, not a list, and "(b)" there follows "and" after a bracket.
// A bare "N." may also follow a heading run on the same line ("Title 1. Text"),
// but never one of the words that make it a reference ("paragraph 2. The").
const REFERENCE_WORD =
  /(?:^|[\s(])(?:articles?|paragraphs?|subparagraphs?|points?|letters?|sections?|chapters?|annex(?:es)?|nos?|and|or|to|of|in|under|with|by|see|from|than)$/i;

function startsAnItem(text: string, at: number, headingOk: boolean): boolean {
  // Consolidated texts carry amendment markers ("▼M8", "►M3") in front of the
  // paragraph they touch; they are not part of the sentence before it.
  const before = text.slice(0, at).replace(/[ \t]+$/, "").replace(/(?:\s*[▼►◄][A-Z]\d*)+[ \t]*$/, "");
  if (before === "" || /[\r\n]$/.test(before)) return true;
  const t = before.replace(/\s+$/, "");
  if (/[;:.]$/.test(t) || /[;:.]\s+(?:and|or)$/i.test(t)) return true;
  return headingOk && /[A-Za-z]$/.test(t) && !REFERENCE_WORD.test(t);
}

/** "points (a) and (b) of paragraph 2", "see paragraph 9.": a reference to a marker, not a marker. */
const isReference = (text: string, at: number): boolean => REFERENCE_WORD.test(text.slice(0, at).replace(/\s+$/, ""));

const MARKER_PATTERNS: Record<MarkKind, Array<[MarkStyle, RegExp]>> = {
  // Priority order: when two styles chain equally well, the first one is read.
  num: [
    ["dot", /(?<![\w.,/-])(\d{1,3})\.(?=\s|$)/g],
    ["paren", /\((\d{1,3})\)/g],
    ["rparen", /(?<![\w(])(\d{1,3})\)/g],
  ],
  alpha: [
    ["paren", /\(([a-z])\)/g],
    ["rparen", /(?<![\w(])([a-z])\)/g],
  ],
};

function marksOf(
  text: string,
  kind: MarkKind,
  style: MarkStyle,
  lo: number,
  hi: number,
  anywhere = false,
): Mark[] {
  const pattern = MARKER_PATTERNS[kind].find(([s]) => s === style)![1];
  const out: Mark[] = [];
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (start < lo || end > hi || m[1] === undefined) continue;
    if (anywhere ? isReference(text, start) : !startsAnItem(text, start, style === "dot")) continue;
    out.push({ value: m[1], start, end });
  }
  return out;
}

/**
 * The run 1, 2, 3... (or a, b, c...) of markers inside [lo, hi), each after the
 * one before. A run, not a bag: "9." is a marker only if 1 to 8 came before it,
 * so a stray "9." in a sentence never makes a paragraph 9 out of an article of
 * seven. The first style (in priority order) with any run is the one read: an
 * article numbered "1." whose sub-list is "(1)...(84)" must be read as
 * paragraphs, not as eighty-four of them. The converse holds too: when several
 * styles chain, the one that starts FIRST is read, because a list that starts
 * inside another's items is a sub-list of it (an article numbered "(1)...(5)"
 * with an inner "1. 2. 3." list is five paragraphs, not the inner list). Ties
 * keep the priority order.
 */
function itemRun(text: string, kind: MarkKind, lo: number, hi: number): Mark[] {
  let best: Mark[] = [];
  for (const [style] of MARKER_PATTERNS[kind]) {
    const marks = marksOf(text, kind, style, lo, hi);
    const run: Mark[] = [];
    let pos = lo;
    for (const m of marks) {
      const want = kind === "num" ? String(run.length + 1) : String.fromCharCode(97 + run.length);
      if (m.start >= pos && m.value === want) {
        run.push(m);
        pos = m.end;
      }
    }
    const first = run[0];
    if (first !== undefined && (best[0] === undefined || first.start < best[0].start)) best = run;
  }
  return best;
}

const ROMAN_LETTER = new Set(["i", "v", "x"]);

/**
 * Does `text` carry the point `segments` names - ["9"] for paragraph 9,
 * ["2","b"] for point (b) of paragraph 2?
 *
 * Each segment is looked for inside the span of the one before it, so (b) must
 * follow paragraph 2's marker and precede paragraph 3's rather than be found
 * anywhere. Conservative by construction: `yes` only when every marker was
 * found in place. `no` only when the text demonstrably numbers items that way
 * somewhere and this marker is not where it should be (and appears nowhere
 * else in that span, not even in a position that could not start an item:
 * "(a) foo, (b) bar" runs on after a comma and the text does carry (b)).
 * Anything else - text with no markers at all, another
 * numbering style, an irregular run, an inserted "1a", a roman sub-point - is
 * `unknown`: the caller is told to open the record, never that it carries the
 * point.
 */
export function textCarriesPoint(text: string, segments: string[]): PointCheck {
  if (segments.length === 0) return "unknown";
  let lo = 0;
  let hi = text.length;
  let prev: MarkKind | null = null;
  for (const seg of segments) {
    const kind: MarkKind | null = /^\d{1,3}$/.test(seg) ? "num" : /^[a-z]$/.test(seg) ? "alpha" : null;
    if (kind === null) return "unknown";
    // (a)(i): a letter after a letter is a roman sub-point; their numbering is not read.
    if (prev === "alpha" && kind === "alpha" && ROMAN_LETTER.has(seg)) return "unknown";
    const index = kind === "num" ? Number(seg) : seg.charCodeAt(0) - 96;
    if (index < 1) return "unknown";
    const run = itemRun(text, kind, lo, hi);
    const found = run[index - 1];
    if (found !== undefined) {
      lo = found.end;
      hi = run[index]?.start ?? hi;
      prev = kind;
      continue;
    }
    // Not in the run. Without any run of this kind in the text there is no
    // evidence it numbers that way at all.
    if (run.length === 0 && itemRun(text, kind, 0, text.length).length === 0) return "unknown";
    // The marker exists but out of sequence, or somewhere an item cannot start
    // (a limb run on after a comma): an irregular text, not an absence.
    const stray = MARKER_PATTERNS[kind].some(([style]) =>
      marksOf(text, kind, style, lo, hi, true).some((m) => m.value === (kind === "num" ? String(index) : seg)),
    );
    return stray ? "unknown" : "no";
  }
  return "yes";
}

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

/** A name for one or more documents, as the words a caller would write it. */
interface AliasEntry {
  tokens: string[];
  docs: Set<string>;
  /**
   * Given by the registry (a title) or by the instrument the citation names (the
   * "Capital Requirements Regulation", "Regulation (EU) No 575/2013"), not one of
   * the ids the records carry. It scopes a citation only when the whole citation
   * is accounted for (`accountedFor`).
   */
  derived?: boolean;
}
type AliasIndex = Map<string, AliasEntry>;

/**
 * Document aliases mapped to the documents they name.
 *
 * A citation identifies its document in whatever spelling the writer knows:
 * the framework ("eba"), the document id ("eba-gl-2017-16"), or the corpus's
 * own short id segment ("gl-2017-16", "egim"). All three are indexed, and an
 * alias naming several documents (a bare framework) narrows the pool to those
 * several rather than picking one.
 *
 * With the registry's holdings, a document's TITLE is a name too: "Article 12 of
 * Guidelines on the application of the definition of default" names a document by
 * what it is called, and without it that document was not named at all, so the
 * bare article number was answered from whichever document had one.
 */
function documentAliases(regulations: Regulation[], holdings?: DocumentHolding[]): AliasIndex {
  const index: AliasIndex = new Map();
  const add = (raw: string, docId: string, derived = false): void => {
    const tokens = citationTokens(raw);
    if (tokens.length === 0) return;
    const key = tokens.join(" ");
    const slot = index.get(key);
    // An id keeps its entry as the ids made it: a derived name never loosens one.
    if (slot === undefined) index.set(key, { tokens, docs: new Set([docId]), ...(derived ? { derived } : {}) });
    else if (derived !== true || slot.derived === true) slot.docs.add(docId);
  };
  for (const r of regulations) {
    add(r.framework, r.document_id);
    add(r.document_id, r.document_id);
    add(idDocSegment(r.id), r.document_id);
    add(`${r.framework} ${r.document_id}`, r.document_id);
  }
  for (const h of holdings ?? []) {
    if (h.title === undefined) continue;
    for (const variant of titleNames(h.title)) add(variant, h.document_id, true);
  }
  return index;
}

/**
 * The words a registry title can be quoted by: the whole title, without its
 * parentheticals, the part before a subtitle, a dash or the clause that names its
 * legal basis ("... on the application of X under Article 178 of Regulation ..."),
 * which is how a guideline is usually called, and a parenthetical that is itself a
 * name ("... ('Downturn LGD estimation')"). Exact windows like every other name,
 * never a fuzzy match, and a variant must carry at least three words that are
 * neither structure nor a bare number, so "Guidelines", "(CRR)" or "Regulation
 * (EU) No 1" can never scope a citation on their own.
 */
function titleNames(title: string): string[] {
  const unbracketed = (t: string): string => t.replace(/\([^)]*\)/g, " ");
  const head =
    title.split(/\s[\u2014\u2013-]\s|:\s|\s(?:under|pursuant\s+to|in\s+accordance\s+with)\s+Articles?\b/i)[0] ?? title;
  const named = [...title.matchAll(/\(([^)]*)\)/g)].map((m) => (m[1] ?? "").replace(/["'\u2018\u2019\u201c\u201d]/g, " "));
  const variants = [title, unbracketed(title), head, unbracketed(head), ...named];
  const words = (t: string): number => citationTokens(t).filter((w) => !STRUCTURAL.has(w) && !/^\d+$/.test(w)).length;
  return [...new Set(variants.map((v) => v.replace(/\s+/g, " ").trim()))].filter((v) => words(v) >= 3);
}

/**
 * The document(s) a citation names, and the tokens that named them.
 *
 * The window is reported so it can be REMOVED before the spine is taken:
 * "EBA GL 2017/16 paragraph 78" carries the numbers 2017 and 16, which belong
 * to the document's name and not to the provision. Left in, they make the
 * spine ["2017","16","78"], which matches nothing — the resolver then falls
 * through to a looser rule, and looser rules are what fabricate.
 *
 * The same document named a second time in another form - its id beside its
 * title, "CRR" beside its number - leaves the citation too. Otherwise the second
 * name's words and numbers ("2016", "07") are read as the provision's. Only a name
 * that denotes nothing but the documents already chosen goes: a bare framework
 * that also names other documents stays, as it always did.
 */
function scopeToDocument(
  tokens: string[],
  index: AliasIndex,
): { docs: Set<string> | null; rest: string[]; derived: boolean } {
  let best: AliasEntry | null = null;
  let bestAt = -1;
  for (const entry of index.values()) {
    const at = windowAt(tokens, entry.tokens);
    if (at === -1) continue;
    // Longest alias wins; among equals, the one naming fewest documents, and then
    // the first indexed (the ids, which come before any derived name).
    const better =
      best === null ||
      entry.tokens.length > best.tokens.length ||
      (entry.tokens.length === best.tokens.length && entry.docs.size < best.docs.size);
    if (better) {
      best = entry;
      bestAt = at;
    }
  }
  if (best === null) return { docs: null, rest: tokens, derived: false };
  let rest = [...tokens.slice(0, bestAt), ...tokens.slice(bestAt + best.tokens.length)];
  for (const other of index.values()) {
    if (other === best || [...other.docs].some((d) => !best.docs.has(d))) continue;
    for (let at = windowAt(rest, other.tokens); at !== -1; at = windowAt(rest, other.tokens)) {
      rest = [...rest.slice(0, at), ...rest.slice(at + other.tokens.length)];
    }
  }
  return { docs: best.docs, rest, derived: best.derived === true };
}

/**
 * A document identifier written the way regulators write them: an authority, an
 * optional kind, then the YEAR and a serial ("EBA/GL/2018/04", "ESMA/2016/1444",
 * "ECB/2017/20"). A bare year/serial pair is not enough - "06/2026" is a date - so
 * the authority has to be there, and it cannot be a structural word ("Article
 * 2018/04"). The pattern takes up to three words in front of the year and
 * `unplacedIdentifier` drops the leading ones that are only connectives ("of").
 * A third number after the serial makes it an ISO date ("2019-12-31"), not an
 * identifier.
 */
const DOCUMENT_IDENTIFIER = /\b((?:[A-Za-z]{1,10}[\s/-]+){1,3})((?:19|20)\d{2})\s*[/-]\s*(\d{1,4})\b(?![/-]\d)/g;

/**
 * Words that carry no document's name: the connectives and determiners of a
 * citation, the generic nouns that say what KIND of text a document is, the words
 * that place a provision inside its own article ("first sentence", "preceding
 * paragraph"), and the formula an EU act is cited with ("of the European Parliament
 * and of the Council of 26 June 2013"). A word of these in front of a number does
 * not make it an identifier ("of the Directive 2018/04"), and a citation whose
 * words are all of these, structure and numbers has nothing in it that could be
 * naming a document (`unexplainedWords`).
 */
const NAME_FILLER = new Set([
  "a", "an", "this", "that", "these", "those", "such", "said", "same", "its", "their", "our", "any", "each",
  "every", "all", "both", "other", "another", "above", "below", "herein", "thereof", "as", "by", "for", "with",
  "from", "to", "or", "per", "see", "also", "cited", "referred", "mentioned", "pursuant", "according",
  "regulation", "regulations", "directive", "directives", "decision", "decisions", "act", "acts", "rule",
  "rules", "standard", "standards", "technical", "document", "documents", "text", "texts", "law", "framework",
  "provision", "provisions", "paragraphs", "item", "items", "clause", "clauses", "para", "art", "ibid", "id",
  // How a provision is pointed at ("as required by", "laid down in").
  "required", "requires", "specified", "set", "out", "laid", "down", "provided", "defined", "stated", "described",
  // Where inside a provision.
  "first", "second", "third", "fourth", "fifth", "last", "final", "preceding", "following", "previous", "next",
  "sentence", "sentences", "indent", "indents", "subparagraphs", "subpoint", "subpoints", "limb", "limbs",
  "introductory", "wording", "version", "applicable", "relevant", "current",
  // How one act relates to another ("as amended by", "supplementing").
  "amended", "supplemented", "implemented", "replaced", "corrected", "repealed", "amending", "supplementing",
  "repealing", "replacing", "correcting",
  // How an act is written: the kind, the institution and the formal formula.
  "reg", "regs", "dir", "eu", "ec", "eec", "euratom", "european", "parliament", "council", "commission", "union",
  "delegated", "implementing", "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/** Roman numerals of two or more letters: the points of a list, as in "Article 178(2)(a)(ii)". */
const ROMAN_NUMERALS = new Set(["ii", "iii", "iv", "vi", "vii", "viii", "ix", "xi", "xii"]);

/**
 * The words of a citation that could be naming something: not structure, not filler,
 * not a number or a point marker. A citation that has none is a provision and the
 * names already taken out of it, nothing else.
 */
const unexplainedWords = (tokens: string[]): string[] =>
  tokens.filter(
    (t) => !STRUCTURAL.has(t) && !NAME_FILLER.has(t) && !ROMAN_NUMERALS.has(t) && !/^\d/.test(t) && t.length > 1,
  );

/** Words that introduce the document a provision belongs to. */
const NAME_CONNECTORS = new Set(["of", "in", "under", "from"]);

/**
 * Content words after the last "of / in / under / from" when no held document was
 * named: the citation says the provision is IN something, and the something is not
 * a name this resolver can place. Null when the tail is only structure and filler.
 * Only the tail is read - a citation with extra words before its provision ("see
 * Article 153") is not saying it belongs to anything.
 */
function unrecognisedNameTail(tokens: string[]): string[] | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!NAME_CONNECTORS.has(tokens[i] ?? "")) continue;
    const words = unexplainedWords(tokens.slice(i + 1));
    return words.length > 0 ? words : null;
  }
  return null;
}

/**
 * The identifier-shaped document number still in the citation after the documents
 * it names were taken out, or null. Its year and serial must both survive in
 * `rest`, adjacent: a held document's name takes them with it.
 */
function unplacedIdentifier(text: string, rest: string[]): string | null {
  for (const m of text.matchAll(DOCUMENT_IDENTIFIER)) {
    const [, lead, year, serial] = m;
    if (lead === undefined || year === undefined || serial === undefined) continue;
    const words = lead.split(/[\s/-]+/).filter((w) => w !== "");
    const plain = (w: string | undefined): boolean => STRUCTURAL.has((w ?? "").toLowerCase()) || NAME_FILLER.has((w ?? "").toLowerCase());
    while (words.length > 0 && plain(words[0])) words.shift();
    // An authority and at most a kind, neither of them structure: "Article 2018/04" is no identifier.
    if (words.length === 0 || words.length > 2) continue;
    if (words.some((w) => plain(w))) continue;
    if (windowAt(rest, [year, serial]) !== -1) return `${words.join("/")}/${year}/${serial}`;
  }
  return null;
}

/**
 * Instruments a citation can name, and how to recognise them in prose.
 *
 * `acts` lists the numbered-act keys that name the same instrument. The CRR is
 * "CRR", "Capital Requirements Regulation", "Regulation (EU) No 575/2013" and a
 * careless "Regulation (EU) 2013/575" alike; a gate that reads only some of those
 * tells a caller the corpus holds no CRR while it holds exactly that. Identity
 * only - what the instrument is called, never what it requires.
 */
const INSTRUMENT_PATTERNS: Array<{ key: string; re: RegExp; acts: string[] }> = [
  {
    key: "crr",
    re: /\bcrr\b|\bcapital\s+requirements\s+regulation\b|regulation\s*\(eu\)\s*(no\.?\s*)?575\s*\/\s*2013|\b575\s*\/\s*2013\b/i,
    acts: ["regulation-2013-575"],
  },
  {
    key: "crd",
    re: /\bcrd\s*(iv|v)?\b|\bcapital\s+requirements\s+directive\b|directive\s*2013\s*\/\s*36/i,
    acts: ["directive-2013-36"],
  },
];

/**
 * Could this be the YEAR half of an EU act number? The Communities began in 1958,
 * so 1907 (REACH is Regulation (EC) No 1907/2006) is a serial that merely looks
 * like a year, and a year does not run past 2099.
 */
const isYearNumber = (s: string): boolean => /^(?:19(?:5[89]|[6-9]\d)|20\d\d)$/.test(s);

/** The institution an act number names, in any of the places writers put it. */
const ACT_TAG = String.raw`(?:eu|ec|eec|euratom)`;

/**
 * The formula an act is formally cited with, "of the European Parliament and of the
 * Council of 26 June 2013": part of the act's name, and a date that is not part of
 * any provision's number, so it has to leave the citation with the act.
 */
const ACT_FORMULA = String.raw`(?:\s+of\s+the\s+european\s+parliament\s+and\s+(?:of\s+)?(?:the\s+)?council` +
  String.raw`(?:\s+of\s+\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})?)?`;

/**
 * How an EU act is numbered in prose. Defined ONCE, because the gate
 * (`namedInstruments`) and the mention scan (`instrumentMentions`) must agree on
 * what a numbered act is, or the refusal names an instrument the scan then cannot
 * find.
 *
 * Kind, then the institution in any of its places - "(EU)", a bare "EU", or the
 * "/EU" that closes "Directive 2014/65/EU" - then the number as serial/YEAR or
 * YEAR/serial, then `ACT_FORMULA`. `guideline` is here because ECB guidelines are
 * numbered the same way ("Guideline (EU) 2017/697").
 *
 * Capture groups: 1 kind, 2 the institution before the number, 3 and 4 the two
 * halves of the number, 5 the institution after it.
 */
const NUMBERED_ACT = new RegExp(
  // Each run of white space follows a token of its own, so a long run can be split
  // between the quantifiers in only one way.
  String.raw`\b(regulation|directive|decision|guideline)s?\s*` +
    String.raw`(?:(\(${ACT_TAG}\)|${ACT_TAG}\b)\s*)?(?:no\.?\s*)?` +
    String.raw`(\d{1,4})\s*\/\s*(\d{1,4})\b` +
    String.raw`(\s*\/\s*${ACT_TAG}\b)?` +
    ACT_FORMULA,
  "gi",
);

/**
 * The same number written the other way round, the number and then the kind
 * ("575/2013 Regulation", "the 2013/36/EU Directive"): how an act is named in prose
 * that does not give its formal citation. Read by the same rules and for the same
 * reason. A gate that reads one order is walked round by the other, and then the
 * number goes on to be read as the CRR's, with the kind word - the only thing that
 * says it is not - ignored: "Article 178 of 575/2013 Directive" was answered with
 * the CRR's Article 178.
 *
 * A number that already belongs to a kind in front of it is not read again
 * (`numberedActs` keeps the kind-first reading), and a kind word that begins the
 * NEXT act ("Directive 2013/36/EU Regulation (EU) No 575/2013") is not this
 * number's kind. Not `guideline`: an EBA guideline is numbered EBA/GL/YYYY/NN and
 * a guideline's "2017/16 Guidelines" names a document, not an act.
 *
 * Capture groups: 1 and 2 the two halves of the number, 3 the institution after it
 * ("/EU"), 4 the institution in brackets, 5 the kind.
 */
const NUMBER_FIRST_ACT = new RegExp(
  // One run of white space at a time, so a long run cannot be split between
  // quantifiers in more than one way.
  String.raw`(?<![\d/])(?:no\.?\s*)?(\d{1,4})\s*\/\s*(\d{1,4})\b\s*` +
    String.raw`(\/\s*${ACT_TAG}\b\s*)?(\(${ACT_TAG}\)\s*)?` +
    String.raw`(regulation|directive|decision)s?\b` +
    String.raw`(?!\s*(?:(?:\(${ACT_TAG}\)|${ACT_TAG}\b)\s*)?(?:no\.?\s*)?\d{1,4}\s*\/\s*\d{1,4}\b)` +
    ACT_FORMULA,
  "gi",
);

interface NumberedAct {
  /** `kind-YEAR-serial`, the same whichever numbering era or order the citation used. */
  key: string;
  /** The institution the citation wrote ("EU", "EC", "EEC", "Euratom"), when it wrote one. */
  tag?: string;
  /** Where the act is written in the text, so it can be cut out or scoped as one name. */
  start: number;
  end: number;
}

/**
 * Which half of a number is the year. Where exactly one half can be a year it is
 * that one. Where both can (2019/2033), the era decides: regulations were numbered
 * serial/YEAR until 2015 and YEAR/serial after it, and directives and decisions
 * have been YEAR/serial throughout. Where neither can, the kind decides.
 */
function yearAndSerial(kind: string, first: string, second: string): [string, string] {
  const yearFirst = kind === "directive" || kind === "decision";
  if (isYearNumber(first) && !isYearNumber(second)) return [first, second];
  if (isYearNumber(second) && !isYearNumber(first)) return [second, first];
  if (isYearNumber(first) && isYearNumber(second)) {
    return yearFirst || Number(first) >= 2015 ? [first, second] : [second, first];
  }
  return yearFirst ? [first, second] : [second, first];
}

/**
 * The numbered acts a text names, in either numbering era and in either order: the
 * kind and then the number (`NUMBERED_ACT`), or the number and then the kind
 * (`NUMBER_FIRST_ACT`). The one reader the gate and the mention scan share.
 *
 * A bare number needs more to be an act than a tagged one. "Regulation 5/2" is
 * not an act number, and neither is "Guidelines 2017/16", which is how a caller
 * names a document that is no act at all (EBA/GL/2017/16): without the
 * institution tag the number must carry a year, and a guideline needs the tag.
 */
function numberedActs(text: string): NumberedAct[] {
  const acts: NumberedAct[] = [];
  const add = (kind: string, first: string, second: string, institution: string | undefined, start: number, end: number): void => {
    const tagged = institution !== undefined;
    if (!tagged && (kind === "guideline" || (!isYearNumber(first) && !isYearNumber(second)))) return;
    const [year, serial] = yearAndSerial(kind, first, second);
    const written = (institution ?? "").replace(/[()\s/]/g, "").toLowerCase();
    const tag = written === "" ? undefined : written === "euratom" ? "Euratom" : written.toUpperCase();
    acts.push({ key: `${kind}-${year}-${serial}`, ...(tag === undefined ? {} : { tag }), start, end });
  };
  for (const m of text.matchAll(NUMBERED_ACT)) {
    const kind = m[1]?.toLowerCase();
    if (kind === undefined || m[3] === undefined || m[4] === undefined) continue;
    add(kind, m[3], m[4], m[2] ?? m[5], m.index, m.index + m[0].length);
  }
  // The number written first. Only where no kind-first act already has those
  // characters: "Directive 2013/36/EU Regulation ..." is one act and the start of another.
  const kindFirst = acts.length;
  for (const m of text.matchAll(NUMBER_FIRST_ACT)) {
    const kind = m[5]?.toLowerCase();
    const end = m.index + m[0].length;
    if (kind === undefined || m[1] === undefined || m[2] === undefined) continue;
    if (acts.slice(0, kindFirst).some((a) => m.index < a.end && a.start < end)) continue;
    add(kind, m[1], m[2], m[3] ?? m[4], m.index, end);
  }
  return acts.sort((a, b) => a.start - b.start);
}

/** One key per instrument, whichever numbering era the citation is written in. */
const numberedActKeys = (text: string): string[] => numberedActs(text).map((a) => a.key);

/** The key a numbered act is known by when a named instrument is the same thing. */
const canonicalInstrument = (key: string): string =>
  INSTRUMENT_PATTERNS.find((p) => p.acts.includes(key))?.key ?? key;

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
 *
 * The same holds for the other spellings of the same number: "Directive
 * 2014/65/EU", "Regulation EU 2019/2033", "Decision 2021/451". Each fell through
 * and had its number read as sub-points of whichever provision shared the first
 * digits.
 */
interface NamedInstrument {
  key: string;
  /** The institution the citation wrote for a numbered act, so a refusal can quote it back rightly. */
  tag?: string;
  /** The words of the citation that name it, so a mention inside a longer name can be told apart. */
  span: string;
}

/**
 * Each place the citation names an instrument: the instruments with a name of their
 * own first, then the numbered acts.
 *
 * A name lying inside the written form of an act of ANOTHER kind is not a mention of
 * the instrument it looks like: "Directive (EC) 575/2013" carries the CRR's number
 * and is not the CRR (no directive has that number), so reading the bare number out
 * of it would hand a provision of one body of law to another.
 */
function instrumentSpans(text: string): Array<NamedInstrument & { start: number; end: number }> {
  const acts = numberedActs(text);
  const spans: Array<NamedInstrument & { start: number; end: number }> = [];
  for (const { key, re } of INSTRUMENT_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      const start = m.index;
      const end = start + m[0].length;
      if (acts.some((a) => a.start <= start && end <= a.end && canonicalInstrument(a.key) !== key)) continue;
      spans.push({ key, span: m[0], start, end });
    }
  }
  for (const act of acts) {
    spans.push({
      key: canonicalInstrument(act.key),
      ...(act.tag === undefined ? {} : { tag: act.tag }),
      span: text.slice(act.start, act.end),
      start: act.start,
      end: act.end,
    });
  }
  return spans;
}

/**
 * Words that make the instrument after them a mention rather than the home of the
 * provision: "Article 178 of the CRR, as amended by Regulation (EU) 2024/1623" is
 * about the CRR, not about the act that amends it. Only the phrases that say so on
 * their own. "under" and "of" are how a caller attaches a provision to its
 * instrument ("Article 14 under Regulation (EU) 2022/439"), so they are not here.
 */
const SUBORDINATING_CUE =
  /\b(?:(?:as\s+)?(?:amended|supplemented|implemented|replaced|corrected|repealed)\s+by|referred\s+to\s+in|pursuant\s+to|in\s+accordance\s+with|(?:adopted|issued)\s+under|within\s+the\s+meaning\s+of|cited\s+in|mentioned\s+in|see\s+also)\s+(?:(?:the|a|an|commission|council|delegated|implementing)\s+)*$/i;

/**
 * Instruments a citation can name by DESCRIPTION rather than by number, and how
 * to recognise each in prose. The single table: `describedInstruments` reads it
 * to find what a citation names, `holdsKind` reads `held` to ask whether the
 * corpus has a document identifying as that kind.
 *
 * Every kind is recognised in every spelling a writer has for it, because the
 * gate is only as good as its weakest spelling: respell the kind and the
 * instrument is dropped, and the bare article number goes looking in whatever
 * held a provision with it. So the acronyms take any case, a plural and dots
 * ("rts", "RTSs", "R.T.S."), and the spelled-out forms take any run of white
 * space or dashes between their words. The one place case still matters is ITS,
 * because "its" is a pronoun in half the prose ever written: ITS matches in
 * upper case, and in any case straight after a determiner ("the its on
 * reporting"), where a pronoun cannot stand. A bare "technical standards" names
 * one of the two without saying which, so either kind releases it. A bare
 * "delegated"/"implementing" is not a description of an instrument; it has to be
 * followed by what the act is. And a descriptor that goes on to give the act's
 * NUMBER in the form the number gate reads ("Delegated Regulation (EU)
 * 2022/439") is not a description at all: that gate owns the citation, and
 * re-reading it here would flip one the corpus resolves today. A number the gate
 * CANNOT read ("Delegated Regulation 2022/439", no "(EU)") is still a
 * description, and is declined as one: it is the same unheld instrument, and
 * falling through is how a same-numbered provision of an unrelated document got
 * offered for it.
 *
 * `held` lists token windows; a corpus document "identifies as" the kind when
 * its framework, document id or id segment contains one as a contiguous run.
 * Tokens, never substrings - "its" is inside "limits", "rts" inside "reports" -
 * and the patterns below are anchored to whole words for the same reason.
 */
const KIND_GAP = String.raw`[\s\-‐-―]+`;
const kindWords = (...words: string[]): string => words.join(KIND_GAP);

const DESCRIBED_INSTRUMENTS: Array<{
  key: string;
  re: RegExp;
  held: string[][];
  /** Also an ordinary English word, so an all-capitals citation cannot be trusted to mean the acronym. */
  pronoun?: boolean;
  /** Who issues it, for kinds that name an issuer ("ECB Guideline"): lets a held document of the same issuer be told apart from the described one. */
  issuer?: string;
  /** The descriptor is the pattern's one capture group; the rest of the match is only what has to stand before it. */
  inGroup?: boolean;
}> = [
  { key: "rts", re: /\bR\.T\.S\b\.?|\bRTSs?\b/gi, held: [["rts"]] },
  {
    key: "rts",
    re: new RegExp(`\\b${kindWords("regulatory", "technical", "standards?")}\\b`, "gi"),
    held: [["rts"], ["regulatory", "technical", "standard"], ["regulatory", "technical", "standards"]],
  },
  { key: "its", re: /\bITSs?\b/g, held: [["its"]], pronoun: true },
  { key: "its", re: /\bI\.T\.S\b\.?/gi, held: [["its"]] },
  // "its" cannot be a pronoun straight after an article ("the its on reporting").
  // Not "that": "a rule that its text amends" is ordinary English. The article is
  // matched, not looked behind for: a look-behind over white space is tried at every
  // position of a run of it, which made a long run cost the square of its length.
  { key: "its", re: /\b(?:the|an?|this)\s+(its)\b/gi, held: [["its"]], inGroup: true },
  {
    key: "its",
    re: new RegExp(`\\b${kindWords("implementing", "technical", "standards?")}\\b`, "gi"),
    held: [["its"], ["implementing", "technical", "standard"], ["implementing", "technical", "standards"]],
  },
  {
    // Not when the word that makes it one of the two above stands before it: that phrase
    // is one of them, and `describedInstruments` leaves it out where it lies inside one.
    key: "technical-standards",
    re: new RegExp(`\\b${kindWords("technical", "standards?")}\\b`, "gi"),
    held: [["rts"], ["its"], ["technical", "standard"], ["technical", "standards"]],
  },
  {
    key: "delegated",
    re: new RegExp(`\\b(?:commission${KIND_GAP})?delegated${KIND_GAP}(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["delegated"]],
  },
  {
    key: "implementing",
    re: new RegExp(`\\b(?:commission${KIND_GAP})?implementing${KIND_GAP}(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["implementing"]],
  },
  ...(["regulation", "guideline", "decision", "recommendation"] as const).map((kind) => ({
    key: `ecb-${kind}`,
    // The ECB, its dotted acronym or its full name, with or without a possessive.
    re: new RegExp(
      `(?:\\becb|\\bE\\.C\\.B\\b\\.?|\\beuropean${KIND_GAP}central${KIND_GAP}bank)(?:['’]s)?\\s+${kind}s?\\b`,
      "gi",
    ),
    held: [["ecb", kind], ["ecb", `${kind}s`], ["european", "central", "bank", kind], ["european", "central", "bank", `${kind}s`]],
    issuer: "ecb",
  })),
  {
    key: "ecb-guideline",
    re: new RegExp(
      `\\bguidelines?\\s+of\\s+the\\s+(?:ecb|european${KIND_GAP}central${KIND_GAP}bank)\\b`,
      "gi",
    ),
    held: [["ecb", "guideline"], ["ecb", "guidelines"]],
    issuer: "ecb",
  },
];

interface DescribedInstrument {
  /** The kind of the table entry that matched, so one kind named twice is quoted once. */
  key: string;
  /** The citation's own words for it, quoted back. */
  quote: string;
  held: string[][];
  /** Written as a numbered identifier ("RTS/2016/03"), not as a description. */
  identifier: boolean;
  /** A number follows the descriptor ("ITS 2021/451"), in a shape the number gate does not read. */
  numbered: boolean;
  /** The issuer the table entry names, if it names one. */
  issuer?: string;
}

/**
 * Where a descriptor's own words end. The kind and what it is on ("RTS on the IRB
 * assessment methodology") belong to it; the punctuation, dash, provision
 * reference or "under / referred to in" that starts something else does not.
 */
const DESCRIPTOR_END =
  /[,;:()[\]"\u201c\u201d]|\s[-\u2013\u2014]\s|\b(?:art(?:icle)?s?|para(?:graph)?s?|sections?|chapters?|annex(?:es)?|points?)\.?\s*\(?\d|\s(?:under|referred|cited|mentioned|pursuant|adopted|according|per|as)\b/i;
/** A full stop that ends the sentence rather than abbreviating a word. */
const SENTENCE_END = /\.(?=\s+[A-Z]|\s*$)/;

/** Where in `after` a held document's name begins (one of `names`, as whole tokens), or -1. */
function nameStartsAt(after: string, names: string[][]): number {
  if (names.length === 0) return -1;
  const words = [...after.matchAll(/[A-Za-z0-9]+/g)].map((m) => ({
    at: m.index,
    token: CITATION_EXPANSIONS[m[0].toLowerCase()] ?? m[0].toLowerCase(),
  }));
  for (let i = 0; i < words.length; i++) {
    if (names.some((n) => n.length > 0 && n.every((t, j) => words[i + j]?.token === t))) return words[i]?.at ?? -1;
  }
  return -1;
}

/**
 * The caller's own words for a described instrument, quoted back in a note: the
 * descriptor and what it is on, cut where something else starts. The whole rest
 * of the clause used to be quoted, which put the held document's id and the
 * provision itself inside "the description". A held document's name cuts it too:
 * "ECB Guideline egim para 3.181" describes "ECB Guideline", and names egim.
 */
function descriptorQuote(text: string, start: number, matched: string, names: string[][]): string {
  const after = text.slice(start + matched.length);
  const stops = [after.search(DESCRIPTOR_END), after.search(SENTENCE_END), nameStartsAt(after, names)].filter((n) => n !== -1);
  const own = `${matched}${stops.length === 0 ? after : after.slice(0, Math.min(...stops))}`;
  const body = own
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\s+(?:of|in|on|under|from|and|or|to|the|an?|as|by|at|for|with|see))+$/i, "")
    .replace(/[:;,\s]+$/, "");
  // A full stop closes a dotted acronym ("R.T.S.") and nothing else.
  const quote = /(?:\b[A-Za-z]\.){2,}$/.test(body) ? body : body.replace(/\.+$/, "");
  return quote.length === 0 || quote.length > 80 ? matched : quote;
}

/**
 * A number straight after a descriptor, as "ITS 2021/451" or "RTS (EU) No 2016/03"
 * give it, or the identifier an authority numbers it with ("ECB Guideline
 * ECB/2014/60"): either names one specific instrument, not a kind of text.
 */
const NUMBER_AFTER_DESCRIPTOR = new RegExp(
  String.raw`^\s*(?:\(${ACT_TAG}\)\s*)?(?:no\.?\s*)?\d{1,4}\s*\/\s*\d{1,4}\b` +
    String.raw`|^\s*(?:\(\s*)?[A-Za-z]{2,10}(?:\s*\/\s*[A-Za-z]{2,10})*\s*\/\s*(?:19|20)\d{2}\s*\/\s*\d{1,4}\b`,
  "i",
);

/**
 * Does the number gate read an act number starting at the kind word that ends this
 * match? It asks the gate's own reader (`numberedActs`), not the raw pattern: the
 * pattern also matches "Regulation 5/2", which is no act number, and a descriptor
 * waved through on the strength of it would be read by neither gate.
 */
function numberGateReads(acts: NumberedAct[], start: number, matched: string): boolean {
  // The kind word is the last run of letters of the match, whatever sat between its words.
  const kindAt = start + matched.search(/[A-Za-z]+$/);
  return acts.some((a) => a.start === kindAt);
}

/**
 * Instruments the citation names by description, and the citation with those
 * words removed (so the rest can be scoped to a held document without "ECB" in
 * "ECB Regulation" being read as the held ECB guide). The words are cut out by
 * POSITION, never by searching for their text: a descriptor spelled "rts" would
 * otherwise be found first inside "reports".
 */
function describedInstruments(
  text: string,
  // The names of the documents the corpus holds, as token windows, so a quote can stop short of one.
  names: string[][] = [],
): { found: DescribedInstrument[]; residual: string } {
  // An all-capitals citation has lost the case that tells ITS from a shouted
  // pronoun. The other kinds have no pronoun reading, so they stay recognised.
  const caseLost = !/[a-z]/.test(text);
  const acts = numberedActs(text);
  const found: DescribedInstrument[] = [];
  const cut: Array<[number, number]> = [];
  // Every match of every kind, in the order the caller wrote them, so a kind named
  // twice is quoted at its first (and usually fuller) mention.
  const all = DESCRIBED_INSTRUMENTS.flatMap((entry) =>
    entry.pronoun === true && caseLost
      ? []
      : [...text.matchAll(entry.re)].map((m) => {
          // The descriptor's own words: the whole match, or the group an entry names.
          const matched = entry.inGroup === true ? (m[1] ?? "") : m[0];
          return { entry, start: m.index + m[0].length - matched.length, matched };
        }),
  );
  // "technical standards" is not a kind of its own where "regulatory" or "implementing"
  // stands before it: the longer phrase is the instrument, and it has already matched.
  const qualified = all.filter((h) => h.entry.key === "rts" || h.entry.key === "its");
  const hits = all
    .filter(
      (h) =>
        h.entry.key !== "technical-standards" ||
        !qualified.some((q) => q.start <= h.start && h.start + h.matched.length <= q.start + q.matched.length),
    )
    .sort((a, b) => a.start - b.start || b.matched.length - a.matched.length);
  for (const { entry: { key, held, issuer }, start, matched } of hits) {
    const end = start + matched.length;
    if (numberGateReads(acts, start, matched)) continue;
    // "EBA/RTS/2016/03" is an identifier. It names its instrument by number, in
    // a shape the number gate does not read, so it is declined for what it is.
    const id = /^\s*\/\s*(\d{4})\s*\/\s*(\d{1,4})\b/.exec(text.slice(end));
    if (id !== null) {
      const lead = /(?:\b[A-Za-z]+\s*\/\s*)*$/.exec(text.slice(0, start))?.[0] ?? "";
      const whole = `${lead}${matched}${id[0]}`.replace(/\s+/g, "");
      if (!found.some((f) => f.quote === whole)) {
        found.push({
          key,
          quote: whole,
          held: [citationTokens(`${matched} ${id[1] ?? ""} ${id[2] ?? ""}`)],
          identifier: true,
          numbered: true,
        });
      }
      cut.push([start - lead.length, end + id[0].length]);
      continue;
    }
    // The same kind named twice in one phrase ("regulatory technical standards
    // (RTS) on ...") is one instrument, quoted once - and not worked out again: the
    // quote reads the rest of the text, so doing it for every mention of a kind made
    // a text that names one many times cost the square of its length.
    if (found.some((f) => f.key === key && !f.identifier)) {
      cut.push([start, end]);
      continue;
    }
    const quote = descriptorQuote(text, start, matched, names);
    if (!found.some((f) => f.quote === quote)) {
      const numbered = NUMBER_AFTER_DESCRIPTOR.test(text.slice(end));
      found.push({ key, quote, held, identifier: false, numbered, ...(issuer === undefined ? {} : { issuer }) });
    }
    cut.push([start, end]);
  }
  // Blank the cut spans, merged so none is cut twice, from the end backwards so
  // earlier offsets stay valid.
  const merged: Array<[number, number]> = [];
  for (const [from, to] of cut.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged[merged.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  let residual = text;
  for (const [from, to] of merged.reverse()) residual = `${residual.slice(0, from)} ${residual.slice(to)}`;
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
    // Keyed as the gate keys the instrument it names, so "Regulation (EU) No
    // 575/2013" in a record's text is found under the CRR however the number is written.
    const seen = new Set<string>(numberedActKeys(r.text).map(canonicalInstrument));
    for (const key of seen) {
      const at = index.get(key);
      if (at === undefined) index.set(key, [r.id]);
      else at.push(r.id);
    }
  }
  mentionCache.set(regulations, index);
  return index;
}

/**
 * The ways an instrument's key can appear, squashed, in a document's ids. A numbered
 * act is looked for in both orders its number is written in ("regulation2013575"
 * and "regulation5752013"), and the CRR and CRD also by the numbers they are
 * known by, because a corpus is free to id them either way.
 */
function heldNeedles(instrument: string): string[] {
  const named = INSTRUMENT_PATTERNS.find((p) => p.key === instrument);
  return [instrument, ...(named?.acts ?? [])].flatMap((key) => {
    const m = /^([a-z]+)-(\d{2,4})-(\d+)$/.exec(key);
    return m === null ? [key.replace(/[^a-z0-9]/g, "")] : [`${m[1]}${m[2]}${m[3]}`, `${m[1]}${m[3]}${m[2]}`];
  });
}

/**
 * The documents whose framework, document id or id segment carry the instrument.
 * Asked once per mention of an instrument in a citation, so it is remembered per
 * corpus: a citation that names one many times would otherwise read every record
 * for each.
 */
const heldDocumentsCache = new WeakMap<object, Map<string, Set<string>>>();
function heldInstrumentDocuments(regulations: Regulation[], instrument: string): Set<string> {
  const byInstrument = heldDocumentsCache.get(regulations) ?? new Map<string, Set<string>>();
  heldDocumentsCache.set(regulations, byInstrument);
  const known = byInstrument.get(instrument);
  if (known !== undefined) return known;
  const needles = heldNeedles(instrument);
  const docs = new Set<string>();
  for (const r of regulations) {
    const hay = `${r.framework}${r.document_id}${idDocSegment(r.id)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (needles.some((n) => hay.includes(n))) docs.add(r.document_id);
  }
  byInstrument.set(instrument, docs);
  return docs;
}

/** Does any served record belong to the instrument this citation names? */
const corpusHolds = (regulations: Regulation[], instrument: string): boolean =>
  heldInstrumentDocuments(regulations, instrument).size > 0;

/**
 * Names for the held instruments a citation mentions.
 *
 * "Article 153 of the Capital Requirements Regulation" and "Article 160 of
 * Regulation (EU) No 575/2013" name a document the corpus holds, but not by any of
 * the words its ids carry. Unrecognised, the instrument was dropped, its number was
 * read as points of the provision, and the bare article number was answered from
 * whichever document had one - for the first, a paragraph of an unrelated guideline.
 * Each mention is added to the index as a name for the documents that carry the
 * instrument, so the ordinary rule applies: the longest name wins, its words leave
 * the citation, and the provision is looked for in those documents only. Added per
 * call, from the text, so nothing is invented that the caller did not write; an
 * instrument no held document carries is the gate's business.
 */
function withInstrumentNames(index: AliasIndex, regulations: Regulation[], text: string): AliasIndex {
  const spans = instrumentSpans(text);
  if (spans.length === 0) return index;
  const named: AliasIndex = new Map(index);
  for (const { key, span } of spans) {
    const docs = heldInstrumentDocuments(regulations, key);
    const tokens = citationTokens(span);
    if (docs.size === 0 || tokens.length === 0) continue;
    const id = tokens.join(" ");
    const slot = named.get(id);
    // A name the ids already give ("crr") stays as the ids made it.
    if (slot === undefined) named.set(id, { tokens, docs, derived: true });
    else if (slot.derived === true) named.set(id, { ...slot, docs: new Set([...slot.docs, ...docs]) });
  }
  return named;
}

/**
 * May a name the registry or the instrument supplied scope this citation?
 *
 * Only when nothing else in it could be naming a different document. A name the
 * ids carry ("crr", "egim") scopes whatever else the citation says, as it always
 * did; a title or an instrument's number is longer and more exact, and so it WINS
 * over the ids, which makes it the one that can be wrong. "Paragraph 181 of EBA
 * guidelines on the identification of the group of connected clients referred to
 * in Regulation (EU) No 575/2013" names the regulation in a clause that only says
 * what the guidelines are issued under; scoped to the regulation, the bare 181
 * would be answered from the wrong body of law. So the scope is taken only when,
 * once the names of the chosen document(s) - and of a framework that contains
 * them - are removed, what is left is structure, filler and numbers: no word that
 * could name another document, and no other instrument still named (its number
 * would read as points). Otherwise the citation is resolved exactly as it was
 * before the derived names existed. An instrument named only as context for a held
 * one (`isContext`) is not a second claim and does not stop the scope.
 */
function accountedFor(
  text: string,
  rest: string[],
  chosen: Set<string>,
  index: AliasIndex,
  isContext: (n: { key: string; start: number }) => boolean,
): boolean {
  for (const n of instrumentSpans(text)) {
    if (!isContext(n) && windowAt(rest, citationTokens(n.span)) !== -1) return false;
  }
  let remaining = rest;
  for (const entry of index.values()) {
    if (![...chosen].every((d) => entry.docs.has(d))) continue;
    for (let at = windowAt(remaining, entry.tokens); at !== -1; at = windowAt(remaining, entry.tokens)) {
      remaining = [...remaining.slice(0, at), ...remaining.slice(at + entry.tokens.length)];
    }
  }
  return unexplainedWords(remaining).length === 0;
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
 * not a thing to emit from a refusal whose whole purpose is not guessing. The same
 * goes for the institution: an act the caller wrote as "(EC)" is quoted back as
 * "(EC)", never relabelled "(EU)"; one written with none is given "(EU)" only
 * where the era makes that the only possible tag, and none before it. Only
 * regulations were numbered serial/YEAR; a directive, decision or guideline is
 * YEAR/serial in every era.
 */
const instrumentLabel = (instrument: string, tag?: string): string => {
  const m = /^(regulation|directive|decision|guideline)-(\d{2,4})-(\d+)$/.exec(instrument);
  if (m === null) return instrument.toUpperCase();
  const kind = `${(m[1] ?? "").charAt(0).toUpperCase()}${(m[1] ?? "").slice(1)}`;
  const year = m[2] ?? "";
  const serial = m[3] ?? "";
  const modern = Number(year) >= 2015;
  const institution = tag ?? (modern ? "EU" : undefined);
  if (modern) return `${kind} (${institution}) ${year}/${serial}`;
  if (m[1] === "regulation") return `${kind}${institution === undefined ? "" : ` (${institution})`} No ${serial}/${year}`;
  return `${kind} ${year}/${serial}${institution === undefined ? "" : `/${institution}`}`;
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
 *   (i) exact normalized-citation equality, then equality against a record's
 *       declared aliases. First, because a record's own citation is the
 *       strongest evidence there is and no gate may refuse it;
 *   (0) instrument gate — a citation naming an instrument the corpus does not
 *       hold resolves to null with a coverage note, never into another
 *       document that shares a number. Named by number, or by description
 *       ("the RTS on …", "an ECB Guideline") when no held document is that kind;
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

  // The document a citation names is stripped from BOTH sides before anything
  // is compared: a record's own citation may repeat it ("CRR Article 180"), a
  // query may omit it ("Art. 180"), and its numbers ("2017/16") are not the
  // provision's.
  //
  // The names are the ids the records carry, the registry's titles, and the
  // instruments the citation mentions (the "Capital Requirements Regulation",
  // "Regulation (EU) No 575/2013"). The last two are DERIVED: they win over an id by
  // being longer, so they only scope a citation that is accounted for - exactly a
  // record's own citation once the name is gone, or nothing left in it that could
  // name another document (`accountedFor`). Otherwise the ids alone decide, as
  // they did before titles and instrument names were names.
  // An instrument named as context for a held one ("... of the CRR, as amended by
  // Regulation (EU) 2024/1623") is not a second claim about where the provision is.
  const spans = instrumentSpans(text);
  const subordinate = (n: { start: number }): boolean =>
    SUBORDINATING_CUE.test(text.slice(0, n.start)) && spans.some((o) => o.start < n.start && corpusHolds(regulations, o.key));
  const attempt = (index: AliasIndex) => {
    const scope = scopeToDocument(queryTokens, index);
    const pool = scope.docs === null ? regulations : regulations.filter((r) => scope.docs?.has(r.document_id) === true);
    const bare = (tokens: string[]): string[] => scopeToDocument(tokens, index).rest;
    // (i) Exact equality of the whole citation, structural words included — so
    // "paragraph 78" does not match a record that says "Article 78".
    // Joined with a SEPARATOR, not concatenated. "Article 4(1)" and "Article 41"
    // tokenise to ["article","4","1"] and ["article","41"]; run together they are
    // both "article41", so a bracketed point silently became a different article
    // number — and on this corpus that offered EBA "Paragraph 41" as the answer
    // to a question about Article 4(1). Matching only ever gets stricter here.
    const nq = scope.rest.join(" ");
    const exactHits = pool.filter((r) => bare(citationTokens(r.citation)).join(" ") === nq);
    // (i-alias) The same equality against a record's declared aliases. Looked for
    // here too, because a derived scope is accepted on either.
    const aliasHits =
      exactHits.length > 0
        ? []
        : pool.filter((r) => (r.citation_aliases ?? []).some((a) => bare(citationTokens(a)).join(" ") === nq));
    // (i-core) The same equality with the connectives left out of both sides, for a
    // citation that has some ("Article 3 of the") and found no exact record.
    const core = (tokens: string[]): string => withoutConnectives(bare(tokens)).join(" ");
    const nqCore = withoutConnectives(scope.rest).join(" ");
    const coreHits =
      exactHits.length > 0 || aliasHits.length > 0 || nqCore === nq
        ? []
        : pool.filter((r) => core(citationTokens(r.citation)) === nqCore);
    return { index, ...scope, pool, bare, nq, exactHits, aliasHits, coreHits };
  };
  let scoped = attempt(withInstrumentNames(documentAliases(regulations, holdings), regulations, text));
  if (
    scoped.derived &&
    scoped.docs !== null &&
    scoped.exactHits.length === 0 &&
    scoped.aliasHits.length === 0 &&
    scoped.coreHits.length === 0 &&
    !accountedFor(text, scoped.rest, scoped.docs, scoped.index, (n) => !corpusHolds(regulations, n.key) && subordinate(n))
  ) {
    scoped = attempt(documentAliases(regulations));
  }
  const { index, docs, rest, pool, bare, exactHits, aliasHits, coreHits } = scoped;

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

  // (i-core) A citation that is a record's own once the connectives are set aside.
  // Before this, a citation the document's name had left a dangling "of the" on was
  // compared by its numbers alone, where a record with the same number and a
  // different kind of citation (a section whose label reduces to "3") tied with the
  // article that was asked for. Kind words and numbers are all equal here, so the
  // tie is broken by the record that says what was asked, and the confidence stays
  // "segment": it is the spine pass's answer, made unambiguous.
  if (coreHits.length === 1) return { ...none(), match: coreHits[0] ?? null, confidence: "segment" };
  if (coreHits.length > 1) return ambiguousResolution(text, coreHits);

  // (0) The instrument gate. A wrong instrument is not a near miss, it is a
  // different body of law - but it comes AFTER the two equality passes above. A
  // record's own citation (or a label it declares) is the strongest evidence a
  // citation can have, and a gate that reads words inside it ("RTS Article 5",
  // "Regulation (EU) 2022/439, Article 14") as a second instrument would refuse
  // the very record the caller quoted.
  //
  // Judged by the first named instrument the corpus does not hold. A held
  // instrument named beside an unheld act does not vouch for it, with two
  // exceptions that are not claims about the act at all. A mention inside the longer
  // name of a document that WAS recognised (a guideline's title quotes the
  // regulation it is issued under) is part of that name. And an act that follows a
  // subordinating phrase after a held instrument ("... of the CRR, as amended by
  // Regulation (EU) 2024/1623") is context for the held instrument, which stays the
  // home of the provision: refusing the citation for the amending act would be the
  // one refusal that is untrue of what was asked.
  const insideName = (n: NamedInstrument): boolean => docs !== null && windowAt(rest, citationTokens(n.span)) === -1;
  const unheldMention = spans.find((n) => !corpusHolds(regulations, n.key) && !insideName(n) && !subordinate(n));
  if (unheldMention !== undefined) {
    const gated = unheldMention.key;
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
    const what = EMPOWERMENTS[gated];
    // Both sources, unioned. `cites[].framework` is the only one that reaches a
    // named framework like `crr`; the text scan is the only one that reaches a
    // numbered act. Each is blind where the other sees.
    const byCite = regulations
      .filter((r) => (r.cites ?? []).some((c) => citationTokens(c.framework).join("") === gated))
      .map((r) => r.id);
    const mentions = [
      ...new Set([...byCite, ...(instrumentMentions(regulations).get(gated) ?? [])]),
    ];
    const shown = mentions.slice(0, 3);
    return none({
      coverage_note:
        `This corpus holds no ${instrumentLabel(gated, unheldMention.tag)}. Nothing was matched, rather than ` +
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

  // The held instrument the citation names, if any: for the descriptive gate, which
  // has to say when a citation names a held instrument AND a described one.
  const heldMention = spans.find((n) => corpusHolds(regulations, n.key));
  const instrument = heldMention?.key ?? null;
  const instrumentName = heldMention === undefined ? null : instrumentLabel(heldMention.key, heldMention.tag);

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
  //
  // One exception, and it is not a second instrument at all: an ECB-kind descriptor
  // ("ECB Guidelines", "ECB Regulation") beside a held document whose framework is
  // that same issuer. "ECB Guidelines (EGIM) Chapter 3, paragraph 181" calls the one
  // document twice, once by what the ECB calls such texts and once by its id, and
  // the id is the exact half. The descriptor is then a loose description of the
  // document named and resolution goes on as if it were absent. Not when the
  // descriptor is numbered or an identifier (that is one specific act), not when
  // another instrument is named, and not when the document named is of another issuer.
  const described = describedInstruments(text, [...index.values()].map((e) => e.tokens));
  const unheld = described.found.filter((d) => !holdsKind(regulations, d.held));
  // Only when there is a provision number to place. Without one nothing can be
  // sourced from a same-numbered provision, and the "no provision number" note
  // below already says the instrument may be described without being held.
  const placeable =
    spineOf(citationTokens(described.residual).filter((t) => !STRUCTURAL.has(t))).length > 0;
  const namedDocs = unheld.length > 0 && placeable ? scopeToDocument(citationTokens(described.residual), index).docs : null;
  const looselyDescribed = ((): boolean => {
    if (namedDocs === null || docs === null || instrumentName !== null) return false;
    if (!unheld.every((d) => d.issuer !== undefined && !d.identifier && !d.numbered)) return false;
    const frameworks = new Set(regulations.filter((r) => namedDocs.has(r.document_id)).map((r) => r.framework.toLowerCase()));
    return frameworks.size === 1 && unheld.every((d) => frameworks.has(d.issuer ?? ""));
  })();
  if (unheld.length > 0 && placeable && !looselyDescribed) {
    const quoted = unheld.map((d) => `"${d.quote}"`).join(" and ");
    const identifiers = unheld.every((d) => d.identifier);
    const heldNames: string[] = [];
    if (instrumentName !== null) heldNames.push(instrumentName);
    // `crr` the instrument and `crr` the document are one thing named twice.
    const instrumentDocs = instrument === null ? new Set<string>() : heldInstrumentDocuments(regulations, instrument);
    for (const d of namedDocs ?? []) {
      if (instrumentDocs.has(d)) continue;
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
    const numberedDescription = !identifiers && unheld.some((d) => d.numbered);
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
    // A description by an issuer's kind ("ECB Guidelines") does not mean the corpus
    // holds nothing from that issuer, and "no document identified as such" must not
    // read as if it did. Listed, never matched: which of them was meant is for the
    // caller to say.
    const issuers = [...new Set(unheld.flatMap((d) => (d.issuer === undefined || d.identifier || d.numbered ? [] : [d.issuer])))];
    const sameIssuer = [...new Set(regulations.filter((r) => issuers.includes(r.framework.toLowerCase())).map((r) => r.document_id))];
    const issuerNote =
      sameIssuer.length === 0
        ? ""
        : ` It does hold ${sameIssuer.length === 1 ? "a document" : "documents"} under the ${issuers.map((i) => i.toUpperCase()).join("/")} ` +
          `framework (${sameIssuer.slice(0, 5).join(", ")}${sameIssuer.length > 5 ? ", …" : ""}); ` +
          "if one of those is what was meant, cite it by its id or title.";
    return none({
      coverage_note:
        heldNames.length === 0
          ? identifiers
            ? `"${text}" names an instrument by an identifier (${quoted}), and this corpus holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a " +
              `same-numbered provision from another document. ${wayOut}`
            : `"${text}" names an instrument by description (${quoted}), and this corpus holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a same-numbered " +
              `provision from another document.${issuerNote} ${wayOut}`
          : `"${text}" names ${heldList} ` +
            `and also an instrument by ${how} (${quoted}) that it holds no document identified ` +
            "as, so which of the two the provision belongs to cannot be told. Nothing was matched, " +
            `rather than sourcing a same-numbered provision from either. Name one instrument per ` +
            `citation. ${wayOut}`,
    });
  }

  // (0c) A document's number that no held document answers to. "Article 49(3) of
  // EBA/GL/2018/04" names a document by its number; when the registry holds no
  // such document, the framework ("EBA") alone scoped the citation and the number
  // fell through into the provision's spine as points 2018 and 04 - which is how
  // an unheld guideline was answered with paragraph 49 of two held ones. A number
  // that a held document's name consumed is gone from `rest`; one still there was
  // not the number of anything held.
  const unplaced = unplacedIdentifier(text, rest);
  if (unplaced !== null) {
    return none({
      coverage_note:
        `"${text}" names a document by the number ${unplaced}, and this corpus holds no document that ` +
        "answers to it, so the number was not read as part of a provision's. Nothing was matched, " +
        "rather than sourcing a same-numbered provision from another document. Use get_corpus_info " +
        "for the documents actually loaded, or search_regulation with the document's name.",
    });
  }

  // (0d) A document named in words nothing here answers to. Past "of", "in" or
  // "under", content words the registry does not recognise name a document the
  // citation is about; with no held document named, the bare provision number
  // would be looked for in every document at once, and a unique hit in one of them
  // is a guess dressed as a match ("Article 5 of Basel III" answered with paragraph
  // 5 of whichever guideline had one). Nothing is returned: a candidate would be
  // the same guess, listed. Not when the citation names a held instrument and its
  // scope was withheld (`accountedFor`): the words may be that instrument's own
  // title, and "does not recognise" would be untrue of it.
  const unrecognised = docs === null && heldMention === undefined ? unrecognisedNameTail(queryTokens) : null;
  if (unrecognised !== null) {
    const held = [...new Set(regulations.map((r) => r.document_id))];
    const partialNote = citationPartialClause(holdings, null);
    return none({
      coverage_note:
        `"${text}" is about something this corpus does not recognise as a document it holds ` +
        `("${unrecognised.join(" ")}"), so a provision with that number in a held document would be a ` +
        "guess. Nothing was matched. Name the document by an id or title get_corpus_info shows" +
        `${held.length === 0 ? "" : ` (${held.slice(0, 6).join(", ")}${held.length > 6 ? ", …" : ""})`}, ` +
        "or drop the words that are not part of its name." +
        `${partialNote === null ? "" : ` ${partialNote}`}`,
    });
  }

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
  // It matters because of how a corpus can be shaped rather than how citations
  // are written: a document may be stored at whole-article granularity, with no
  // record carrying a bracketed citation, while most of the cross-references the
  // corpus makes about itself are bracketed sub-article points. So "Article
  // 181(1)(b)" was a bare miss reading "nothing in this corpus is numbered
  // 181.1.b", for a provision served in full, whose text contains point (b)
  // verbatim.
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
    // Which document the container is in is part of the claim. Containers from
    // several documents are not alternatives for one provision, they are different
    // provisions that happen to share a number, and presenting the first of them
    // as "the provision containing it" - then reading ITS text for the point -
    // verifies the wrong document's text for a citation that may be about
    // another. So when the containers span documents there is no best one, and no
    // verdict on any text: the candidates are listed by document and the caller
    // is asked to name one.
    const holders = [...new Set(containers.map(({ r }) => r.document_id))];
    if (holders.length > 1) {
      // The narrowest container of each document, so every document is represented
      // however many nested records one of them holds.
      const perDocument = holders.map((d) => containers.find(({ r }) => r.document_id === d)!.r);
      const listed = perDocument.slice(0, MAX_CANDIDATES);
      const where =
        docs === null
          ? `sit in ${holders.length} documents (${holders.slice(0, 5).join(", ")}${holders.length > 5 ? ", …" : ""}) and the citation names none of them`
          : `sit in ${holders.length} of the documents it names (${holders.slice(0, 5).join(", ")}${holders.length > 5 ? ", …" : ""})`;
      return none({
        unmatched_segments: spine,
        candidates: listed.map(asCandidate),
        coverage_note:
          `No record is "${text}" itself — this corpus does not address provisions at that granularity. ` +
          `Records that could contain it ${where}, so which one it belongs to cannot be told, and nothing ` +
          `is said here about whether the text of any of them has the point. ` +
          `${perDocument.length > listed.length ? `(First ${MAX_CANDIDATES} listed.) ` : ""}` +
          "Name the document, or open the candidates and check.",
      });
    }
    const best = containers[0]!;
    const points = spine.slice(best.rs.length);
    const inside = points.join(".");
    // The note used to say the text "carries" the point without looking. An
    // article of seven paragraphs does not carry point 9, and a caller told it
    // does goes looking and quotes around the gap. Only a verified `yes` keeps
    // that sentence.
    const carries = textCarriesPoint(best.r.text, points);
    const held = `It holds the provision containing it: "${best.r.citation}" (${best.r.id})`;
    const tail =
      carries === "yes"
        ? `, whose text carries point ${inside}. Open it and quote the point from its text rather than citing this resolution.`
        : carries === "no"
          ? `, but no point ${inside} was found in its text; its numbering may differ. Open it and ` +
            "check before anything is cited from this resolution."
          : `; whether its text has point ${inside} could not be established, as its numbering could not be read ` +
            "reliably. Open it.";
    return none({
      unmatched_segments: spine,
      candidates: containers.slice(0, MAX_CANDIDATES).map(({ r }) => asCandidate(r)),
      coverage_note:
        `No record is "${text}" itself — this corpus does not address provisions at that ` +
        `granularity. ${held}${tail}`,
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
