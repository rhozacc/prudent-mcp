/**
 * Deterministic field-scoped ranked search — shared by every adapter that
 * implements `search(query)`.
 *
 * Replaces the old JSON.stringify substring scan, which matched keys and URIs
 * (query "regulation" hit 100% of records) and dumped the whole corpus on an
 * empty query. Contract here:
 *
 *   - The query is tokenized (lowercased, split on non-alphanumerics, empties
 *     dropped). An empty or whitespace-only query returns [] — enumeration is
 *     `list()`'s job, never search's.
 *   - The query is stopword-filtered first: common function words are dropped
 *     unless they contain a digit. Filtering is by list and not by length,
 *     because a citation's point segment ("180(1)(a)") is one character and
 *     carries meaning.
 *   - Ranking is BM25F over the declared fields, each with a weight: a term's
 *     weighted frequency is the weight-scaled, length-normalised sum of its
 *     frequency in every field, saturated (k1) and multiplied by the term's
 *     inverse document frequency. Terms are STEMMED, at index and at query time
 *     by the same function (`stem`), so "estimation" finds "estimating".
 *
 *     Why BM25F and not the sum it replaced. The old score was a sum over query
 *     tokens of `weight × occurrences` with no notion of how common a token is,
 *     so on a real corpus a long background section that said "data" forty times
 *     outranked the one operative paragraph that said "representativeness" once,
 *     and a result list was ordered by "how many of the query's words" first
 *     only to patch that. IDF makes the rare word decide, saturation stops
 *     repetition from counting for ever, and length normalisation stops a long
 *     record winning by being long. Coverage is therefore no longer a sort key;
 *     it is still computed and still the signal behind the weak-match notice.
 *   - Optional per-call knobs (`RankOptions`): a glossary, whose abbreviations
 *     reach the phrases the texts use; an `exclude` filter; and a `prior`
 *     multiplier. Statistics are always taken over the WHOLE item list, so
 *     excluding a record does not change what the others score.
 *
 *     A glossary phrase is scored as ONE pseudo-term, present where its words
 *     occur next to each other, with its own document frequency. Two shortcuts
 *     were tried and were wrong: adding the phrase's words one by one let
 *     "reference data set" outweigh the very abbreviation the caller typed, and
 *     OR-ing them alone put every record that says "data" into the results of a
 *     query for "rds". The phrase is an alternative to the abbreviation, never a
 *     requirement beside it: a record that says "rds" and one that says
 *     "reference data set" are both found.
 *   - A query stem of four or more letters also reaches longer words that
 *     contain it ("calibrat" finds "recalibrations") at a quarter of the weight,
 *     as the substring match it replaces did. Such a match scores but never
 *     counts toward coverage, so a loose hit cannot claim a term was found.
 *   - Results are ordered by score, ties broken by input order, so the ranking
 *     is fully deterministic. One guard sits above the score: a record that
 *     matched nothing but loosely (coverage 0) never outranks one that matched a
 *     typed term as a word, however the arithmetic falls — that guarantee came
 *     free with the coverage-first sort and is kept on purpose.
 *   - Each result carries the matched field and an excerpt centred on the
 *     densest cluster of query-term hits in the record's best-scoring field,
 *     widened to word boundaries so it can be quoted. An excerpt that cannot
 *     be quoted is a pointer, not context, and forces a second call.
 *
 * The per-surface field sets live at the bottom of this file so ranking
 * behavior is defined once and reused by the file adapter, the in-memory
 * demo, and any external backend that wants parity.
 */
import type { Check, Playbook, Regulation, Source, Test } from "./schema.ts";

// --- Core -----------------------------------------------------------------

export interface SearchField<T = unknown> {
  name: string;
  weight: number;
  get(record: T): string | string[] | undefined;
}

export interface SearchMatch<T> {
  record: T;
  score: number;
  /**
   * How many of the query's distinct tokens this record matched as WHOLE words
   * (a record placed only on partial-word matches has coverage 0). Not a sort
   * key, but worth surfacing: `coverage < query_tokens` tells a caller the hit
   * is partial before it reads the excerpt and assumes otherwise.
   */
  coverage: number;
  /** Distinct tokens in the query, so `coverage` can be read as a fraction. */
  query_tokens: number;
  /**
   * `field_chars` is the length of the field the excerpt was cut from, so a
   * caller can derive whether it was truncated from server-side truth rather
   * than from the presence of an ellipsis. The ellipses are a decoration
   * makeExcerpt controls: deleting them would take any "is this excerpt
   * complete?" check from 63% to 100% without changing a single excerpt.
   */
  matched: { field: string; excerpt: string; field_chars: number };
}

/**
 * No cap by default. rankedSearch used to slice to 20 before the tool layer
 * counted, so `total_matches` reported a page size on every query of every
 * surface — and paging past it returned nothing, which made the obvious way to
 * verify the figure confirm it. Ranking returns everything it ranked; the tool
 * layer pages.
 */
const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;
/**
 * Wide enough to carry a whole clause. The old 120 produced excerpts that could
 * not be quoted or reasoned from, so a caller had to fetch the record to find
 * out whether the hit was real — which doubled the cost of every answer.
 */
const EXCERPT_WINDOW = 340;

/**
 * Tokens that carry no retrieval signal but do enormous damage if scored.
 *
 * They match as substrings almost immediately in any English text ("of" inside
 * "proof", "in" inside "institution"), which had two consequences: the excerpt
 * window anchored on their position and so pinned to the head of the record,
 * and every record earned a free point of `coverage` — the primary sort key.
 * The result was a result list that looked ranked and was not.
 */
const STOPWORDS = new Set(
  ("a an and any are as at be been being but by can could do does for from had has have how in into is it its may" +
    " must no nor not of on or should so such than that the their them then there these they this those to under" +
    " until up was were what when where which while who whom why will with within would")
    .split(" "),
);

/**
 * Query tokens worth scoring: everything except stopwords.
 *
 * Filtering on the list alone, rather than also on length, is deliberate —
 * legal citations carry meaningful one-character segments ("Article 180(1)(a)")
 * and a blanket length rule would throw the point away.
 */
export function tokenize(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
  const kept = raw.filter((t) => /\d/.test(t) || !STOPWORDS.has(t));
  // A query made entirely of stopwords ("the of") is still a query; fall back
  // rather than silently returning nothing.
  return kept.length > 0 ? kept : raw;
}

/**
 * How many DISTINCT meaningful terms the query holds - the denominator
 * `coverage` is read against. Tokens are not deduplicated by `tokenize` (a
 * repeated word scores twice), but a record can cover a word only once, so
 * counting the repeat would make a query that says "rate rate" look as if every
 * hit missed half of it.
 */
export function distinctQueryTokens(query: string): number {
  return new Set(tokenize(query)).size;
}

const isAlphanumeric = (ch: string): boolean => /[a-z0-9]/.test(ch);

// --- Analysis ---------------------------------------------------------------

/**
 * Light stemming, applied identically at index and query time (it is one
 * function, and both sides call it — a mismatch between the two is the classic
 * way a search engine silently stops finding things).
 *
 * INFLECTION only: plurals, then one of "-ing"/"-ed", then a final "e", so the
 * forms of one verb meet ("estimate", "estimates", "estimating", "estimated" →
 * "estimat"; "model", "models", "modelling" → "model"). Numbers are never
 * touched, and nothing is cut below a stem of three letters.
 *
 * DERIVATION is left alone on purpose. A first version also folded "-ness",
 * "-ment", "-ation" and "-ive", so "representativeness" met "representative"
 * and "representation". Measured on a real corpus that LOST ground: every
 * generic "representative of the portfolio" became a match for the query that
 * wanted the heading "Representativeness of the data", and fewer of the
 * provisions the query needed reached the top 50 across five phrasings, where
 * inflection-only was level with no stemming at all. Words a derivation
 * apart usually mean different things to a reader of regulation ("operative",
 * "operation", "operational"); the glossary is the place for the few that do not.
 */
export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) return token;
  let s = token;
  // Plurals: policies → policy, classes → class, models → model; but not
  // "analysis", "status" or "process", whose final s is part of the word.
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (/(?:ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith("s") && !/(?:ss|us|is)$/.test(s)) s = s.slice(0, -1);

  // "-ing" / "-ed", only where a stem with a vowel and three letters is left
  // ("string" and "used" are words, not verb forms), undoubling "modell" → "model".
  for (const suffix of ["ing", "ed"]) {
    if (!s.endsWith(suffix)) continue;
    const base = s.slice(0, s.length - suffix.length);
    if (base.length >= 3 && /[aeiouy]/.test(base)) {
      s = /([a-z])\1$/.test(base) && !/(?:ss|zz)$/.test(base) ? base.slice(0, -1) : base;
      break;
    }
  }
  return s.length > 4 && s.endsWith("e") ? s.slice(0, -1) : s;
}

/** Every word of `text` as a stem, with its offset — what index and excerpt both read. */
function analyze(text: string): Array<{ term: string; at: number }> {
  const out: Array<{ term: string; at: number }> = [];
  const lower = text.toLowerCase();
  const word = /[a-z0-9]+/g;
  for (let m = word.exec(lower); m !== null; m = word.exec(lower)) out.push({ term: stem(m[0]), at: m.index });
  return out;
}

/** Abbreviation (or phrase) → the phrases the texts use for it. */
export type Glossary = Record<string, string[]>;

/** Per-call knobs of `rankedSearch`; every one is optional. */
export interface RankOptions<T = unknown> {
  /** Expands a query term by OR into the words of its phrases; absent = no expansion. */
  glossary?: Glossary | undefined;
  /** A record this call must not return. Statistics still count it. */
  exclude?: ((record: T) => boolean) | undefined;
  /** Multiplier on a record's score, > 0. */
  prior?: ((record: T) => number) | undefined;
}

// --- Index ------------------------------------------------------------------

interface Posting {
  doc: number;
  /** Term frequency in each field, in the order of the field set. */
  tf: number[];
}

interface Index {
  n: number;
  /** Field length in terms, per field then per doc. */
  lens: number[][];
  avgLen: number[];
  postings: Map<string, Posting[]>;
  /** Alphabetic terms of 4+ letters, for the discounted substring reach. Built on first use. */
  vocab?: string[];
}

/**
 * One index per (item list, field set), built on first use and kept for as long
 * as the list lives. The adapters hand in the same array on every call, so a
 * server pays for the index once. Keyed on the field OBJECTS (the per-surface
 * sets below are module constants), so two calls agree on what was indexed.
 */
const INDEXES = new WeakMap<object, Array<{ fields: ReadonlyArray<SearchField<never>>; index: Index }>>();

function indexFor<T>(items: T[], fields: SearchField<T>[]): Index {
  const entries = INDEXES.get(items) ?? [];
  const hit = entries.find(
    (e) =>
      e.index.n === items.length &&
      e.fields.length === fields.length &&
      e.fields.every((f, i) => f === (fields[i] as unknown)),
  );
  if (hit !== undefined) return hit.index;

  const lens: number[][] = fields.map(() => new Array<number>(items.length).fill(0));
  const postings = new Map<string, Posting[]>();
  items.forEach((record, doc) => {
    const local = new Map<string, number[]>();
    fields.forEach((field, fi) => {
      const raw = field.get(record);
      if (raw === undefined) return;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        for (const { term } of analyze(value)) {
          lens[fi]![doc]! += 1;
          let tf = local.get(term);
          if (tf === undefined) {
            tf = new Array<number>(fields.length).fill(0);
            local.set(term, tf);
          }
          tf[fi]! += 1;
        }
      }
    });
    for (const [term, tf] of local) {
      const list = postings.get(term);
      if (list === undefined) postings.set(term, [{ doc, tf }]);
      else list.push({ doc, tf });
    }
  });
  const avgLen = lens.map((l) => (items.length === 0 ? 0 : l.reduce((a, b) => a + b, 0) / items.length));
  const index: Index = { n: items.length, lens, avgLen, postings };
  INDEXES.set(items, [...entries.filter((e) => e.index.n === items.length), { fields, index }]);
  return index;
}

const K1 = 1.2;
const B = 0.75;
/** A glossary phrase is a guess about intent, so it counts for less than a word the caller typed. */
const EXPANSION_WEIGHT = 0.8;
/** The substring reach, as the old scan's quarter weight. */
const SUBSTRING_WEIGHT = 0.25;
/** At most this many hit positions go to `makeExcerpt`, which is quadratic in them. */
const MAX_EXCERPT_HITS = 48;

/**
 * Glossary entries a query triggers, with the query words each one answers. A key
 * is one or more words ("rds", "cat a"); it triggers when its words appear
 * consecutively among the query's raw words, stopwords included, because "a" in
 * "cat a" is part of the key.
 */
function glossaryTriggers(
  query: string,
  glossary: Glossary | undefined,
): Array<{ words: string[]; phrases: string[] }> {
  if (glossary === undefined) return [];
  const raw = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  const out: Array<{ words: string[]; phrases: string[] }> = [];
  for (const [key, phrases] of Object.entries(glossary)) {
    const words = key.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
    if (words.length === 0) continue;
    for (let i = 0; i + words.length <= raw.length; i++) {
      if (words.every((w, j) => raw[i + j] === w)) {
        out.push({ words, phrases });
        break;
      }
    }
  }
  return out;
}

/**
 * A position a quotation may end on — used ONLY by the long-sentence fallback
 * in makeExcerpt, never by sentenceSpans.
 *
 * Sentence terminators, plus the `;` that ends a point of a legal enumeration:
 * in an instrument that numbers its obligations "(a) …; (b) …;" the point, not
 * the paragraph, is the unit of meaning.
 *
 * A colon is deliberately NOT one. "…shall apply the following requirements:"
 * promises an enumeration the excerpt does not carry, and 7.9% of snapped
 * excerpts land there. A comma is not one either: "…, where one" is not a
 * statement.
 *
 * And sentenceSpans must keep its sentence-only rule. Delegating to this would
 * split every enumerated paragraph into limbs, which raises excerpts that BEGIN
 * on an orphaned "(c) …" — stripped of the chapeau carrying their addressee and
 * trigger — from 3.3% to 15.4%. That is the same defect class as a confident
 * wrong citation.
 */
function isClauseEnd(text: string, i: number): boolean {
  const ch = text[i] ?? "";
  if (ch !== "." && ch !== "!" && ch !== "?" && ch !== ";") return false;
  const after = text[i + 1];
  return after === undefined || after === " " || after === "\n" || after === "\t";
}

/**
 * How far past the budget the fallback may run to reach a clause end, rather
 * than stop mid-clause. Past this the caller is better served by the record.
 */
const EXCERPT_OVERRUN = 560;

/** An enumeration marker at the head of a fragment: "(c) ", "(iv)", "3) ". */
const ENUM_HEAD = /^\s*\(?[a-z0-9]{1,3}\)/i;

/**
 * Sentence spans of a field, as [start, end) pairs covering the whole string.
 *
 * A terminator only ends a sentence when whitespace follows it: "Art. 178",
 * "5.5" and "(a)." are not sentence ends, and splitting there is how an excerpt
 * ends up cut mid-citation.
 */
function sentenceSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i] ?? "";
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const after = text[i + 1] ?? "";
    if (after !== " " && after !== "\n" && after !== "\t") continue;
    spans.push([start, i + 1]);
    start = i + 2;
  }
  if (start < text.length) spans.push([start, text.length]);
  return spans;
}

/**
 * Excerpt as a run of WHOLE sentences around the densest cluster of query-term
 * hits, so it can be read, quoted and reasoned from.
 *
 * Two earlier versions of this were not enough. Anchoring on a single index —
 * the earliest occurrence of any token — put the window wherever the commonest
 * token first appeared, which with stopwords scored was the head of the record:
 * excerpts came back near-identical whatever you asked. Snapping the character
 * window to word boundaries fixed the mid-word cuts but still ended mid-clause
 * about half the time, and an excerpt that cannot be quoted is a pointer, not
 * context — the caller opens the full record to find out whether the hit was
 * real, so the excerpt has cost tokens and saved nothing.
 *
 * Whole sentences make the unit of context a unit of meaning. The budget is
 * still honoured: sentences are added around the centre while they fit, and a
 * single sentence longer than the budget falls back to a word-boundary window
 * inside it.
 */
function makeExcerpt(text: string, hits: number[]): string {
  if (text.length <= EXCERPT_WINDOW) return text;

  // Densest cluster: the hit whose window covers the most other hits.
  let centre = hits[0] ?? 0;
  let best = -1;
  for (const h of hits) {
    const covered = hits.filter((o) => Math.abs(o - h) <= EXCERPT_WINDOW / 2).length;
    if (covered > best) {
      best = covered;
      centre = h;
    }
  }

  const spans = sentenceSpans(text);
  let at = spans.findIndex(([s, e]) => centre >= s && centre < e);
  if (at === -1) at = 0;
  const centreSpan = spans[at];
  if (centreSpan === undefined) return text.slice(0, EXCERPT_WINDOW);

  let [start, end] = centreSpan;
  if (end - start <= EXCERPT_WINDOW) {
    // Grow by whole sentences, preferring the side that is shorter so the
    // excerpt stays centred on the match rather than running off one way.
    let lo = at;
    let hi = at;
    for (;;) {
      const prev = lo > 0 ? spans[lo - 1] : undefined;
      const next = hi < spans.length - 1 ? spans[hi + 1] : undefined;
      const prevCost = prev === undefined ? Number.POSITIVE_INFINITY : prev[1] - prev[0];
      const nextCost = next === undefined ? Number.POSITIVE_INFINITY : next[1] - next[0];
      if (prevCost === Number.POSITIVE_INFINITY && nextCost === Number.POSITIVE_INFINITY) break;
      const takePrev = prevCost <= nextCost;
      const cost = takePrev ? prevCost : nextCost;
      if (end - start + cost > EXCERPT_WINDOW) break;
      if (takePrev && prev !== undefined) { lo -= 1; start = prev[0]; }
      else if (next !== undefined) { hi += 1; end = next[1]; }
    }
  } else {
    // One sentence longer than the whole budget: window inside it, on word
    // boundaries, and let the ellipses say it was cut.
    start = Math.max(centreSpan[0], Math.min(centre - Math.floor(EXCERPT_WINDOW / 3), centreSpan[1] - EXCERPT_WINDOW));
    end = Math.min(centreSpan[1], start + EXCERPT_WINDOW);
    while (start > centreSpan[0] && isAlphanumeric(text[start - 1] ?? "") && isAlphanumeric(text[start] ?? "")) start--;
    while (end < centreSpan[1] && isAlphanumeric(text[end - 1] ?? "") && isAlphanumeric(text[end] ?? "")) end++;

    // Snap the tail back to a clause end inside the window, keeping the hit.
    // Without this the excerpt ends wherever the character count ran out, which
    // is why ~44% of hits — the share of regulation text living in enumerated
    // paragraphs longer than the window — could never be quoted.
    let snapped = false;
    for (let i = end - 1; i > centre; i--) {
      if (isClauseEnd(text, i)) { end = i + 1; snapped = true; break; }
    }
    if (!snapped) {
      const reach = Math.min(centreSpan[1], centre + EXCERPT_OVERRUN);
      for (let i = end; i < reach; i++) if (isClauseEnd(text, i)) { end = i + 1; break; }
    }
    // Snap the head forward, but never ONTO an enumerated limb: "(c) include an
    // additional margin of conservatism…" without its chapeau has lost the
    // addressee and the trigger. Keep the wider start instead.
    for (let i = start; i < centre; i++) {
      if (!isClauseEnd(text, i)) continue;
      const cand = i + 1;
      if (ENUM_HEAD.test(text.slice(cand, cand + 8))) break;
      start = cand;
      break;
    }
    while (start < end && /\s/.test(text[start] ?? "")) start++;
  }

  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Records carrying `words` as a run, with the number of runs in each field: the
 * term frequencies of a glossary phrase treated as a single term. Only records
 * holding every word are looked at, so the scan stays small.
 */
function phraseTfs<T>(
  items: T[],
  fields: SearchField<T>[],
  index: Index,
  words: string[],
): Map<number, number[]> {
  const lists = words.map((w) => index.postings.get(w));
  const out = new Map<number, number[]>();
  if (lists.some((l) => l === undefined)) return out;
  const sorted = (lists as Posting[][]).slice().sort((x, y) => x.length - y.length);
  const others = sorted.slice(1).map((l) => new Set(l.map((p) => p.doc)));
  for (const { doc } of sorted[0]!) {
    if (!others.every((set) => set.has(doc))) continue;
    const tf = new Array<number>(fields.length).fill(0);
    fields.forEach((field, fi) => {
      const raw = field.get(items[doc]!);
      if (raw === undefined) return;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        const terms = analyze(value).map((x) => x.term);
        for (let i = 0; i + words.length <= terms.length; i++) {
          if (words.every((w, j) => terms[i + j] === w)) tf[fi]! += 1;
        }
      }
    });
    if (tf.some((n) => n > 0)) out.set(doc, tf);
  }
  return out;
}

export function rankedSearch<T>(
  items: T[],
  query: string,
  fields: SearchField<T>[],
  limit: number = DEFAULT_LIMIT,
  options: RankOptions<T> = {},
): SearchMatch<T>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const distinct = [...new Set(tokens)];
  const index = indexFor(items, fields);
  if (index.n === 0) return [];

  // Query terms and how much each counts. A word the caller typed counts in
  // full; a longer word that merely contains a typed stem counts a quarter and
  // never establishes coverage. Glossary phrases are scored apart, below.
  const stems = distinct.map((t) => stem(t));
  const weights = new Map<string, number>();
  for (const st of stems) weights.set(st, 1);
  if (index.vocab === undefined) index.vocab = [...index.postings.keys()].filter((t) => /^[a-z]{4,}$/.test(t));
  for (const st of stems) {
    if (!/^[a-z]{4,}$/.test(st)) continue;
    for (const v of index.vocab) if (v !== st && v.includes(st) && !weights.has(v)) weights.set(v, SUBSTRING_WEIGHT);
  }
  const triggers = glossaryTriggers(query, options.glossary);
  const phrases = triggers.flatMap((t) =>
    t.phrases
      .map((p) => analyze(p).map((x) => x.term))
      .filter((words) => words.length > 0)
      .map((words) => ({ words, answers: distinct.filter((tok) => t.words.includes(tok)) })),
  );

  const norm = (fi: number, doc: number): number => {
    const avg = index.avgLen[fi] || 1;
    return 1 - B + (B * index.lens[fi]![doc]!) / avg;
  };

  interface Acc {
    score: number;
    perField: number[];
    /** Typed stems found in the record. */
    present: Set<string>;
    /** Typed words whose glossary phrase the record carries. */
    answered: Set<string>;
  }
  const acc = new Map<number, Acc>();
  const credit = (doc: number, tf: number[], idf: number, weight: number): Acc => {
    let wtf = 0;
    const parts = tf.map((f, fi) => {
      const w = fields[fi]!.weight;
      const part = f === 0 || w <= 0 ? 0 : (w * f) / norm(fi, doc);
      wtf += part;
      return part;
    });
    let a = acc.get(doc);
    if (a === undefined) {
      a = { score: 0, perField: new Array<number>(fields.length).fill(0), present: new Set(), answered: new Set() };
      acc.set(doc, a);
    }
    if (wtf === 0) return a;
    const contribution = weight * idf * (wtf / (K1 + wtf));
    a.score += contribution;
    parts.forEach((part, fi) => {
      a!.perField[fi]! += contribution * (part / wtf);
    });
    return a;
  };
  const idfOf = (docsWithTerm: number) => Math.log(1 + (index.n - docsWithTerm + 0.5) / (docsWithTerm + 0.5));

  for (const [term, qw] of weights) {
    const list = index.postings.get(term);
    if (list === undefined) continue;
    const idf = idfOf(list.length);
    for (const { doc, tf } of list) {
      const a = credit(doc, tf, idf, qw);
      if (qw === 1) a.present.add(term);
    }
  }
  for (const phrase of phrases) {
    const tfs = phraseTfs(items, fields, index, phrase.words);
    const idf = idfOf(tfs.size);
    for (const [doc, tf] of tfs) {
      const a = credit(doc, tf, idf, EXPANSION_WEIGHT);
      for (const tok of phrase.answers) a.answered.add(tok);
    }
  }
  // Terms whose positions the excerpt looks for: what was typed, what loosely
  // contains it, and the words of the phrases that matched.
  const hitTerms = new Set<string>([...weights.keys(), ...phrases.flatMap((p) => p.words)]);

  const scored: Array<SearchMatch<T> & { order: number; field: SearchField<T> }> = [];
  for (const [doc, a] of acc) {
    const record = items[doc]!;
    if (a.score <= 0 || options.exclude?.(record) === true) continue;
    const prior = options.prior?.(record) ?? 1;
    let bestField = 0;
    a.perField.forEach((v, fi) => {
      if (v > a.perField[bestField]!) bestField = fi;
    });
    const covered = distinct.filter((tok, i) => a.present.has(stems[i]!) || a.answered.has(tok)).length;
    scored.push({
      record,
      score: a.score * prior,
      coverage: covered,
      query_tokens: distinct.length,
      matched: undefined as never, // replaced by the lazy accessor below
      order: doc,
      field: fields[bestField]!,
    });
  }

  return scored
    .sort(
      (x, y) =>
        Number(y.coverage > 0) - Number(x.coverage > 0) || y.score - x.score || x.order - y.order,
    )
    .slice(0, Math.max(0, limit))
    .map(({ record, score, coverage, query_tokens, field }) => {
      // The excerpt is the expensive part and a page shows twenty rows of a
      // result that can run to a thousand, so it is cut on first read.
      let cut: SearchMatch<T>["matched"] | undefined;
      return {
        record,
        score,
        coverage,
        query_tokens,
        get matched() {
          if (cut === undefined) {
            const e = excerptFor(record, field, hitTerms);
            cut = { field: field.name, excerpt: e.excerpt, field_chars: e.chars };
          }
          return cut;
        },
      };
    });
}

/**
 * The ranking behind a list of records, remembered by the list itself.
 *
 * An adapter's `search` returns records, and the tool layer needs the matches
 * (coverage, excerpts) that produced their order. Re-ranking the returned
 * records rebuilds an index over them on every call, which cost about four
 * times the search itself; an adapter that ranks with `rankedRecords` lets the
 * tool layer read the ranking back instead. Keyed on the array object, so an
 * adapter that returns anything else (or a list someone has since reordered)
 * simply has no entry and is re-ranked as before.
 */
const RANKINGS = new WeakMap<object, SearchMatch<never>[]>();

export function rankedRecords<T>(
  items: T[],
  query: string,
  fields: SearchField<T>[],
  limit: number = DEFAULT_LIMIT,
  options: RankOptions<T> = {},
): T[] {
  const matches = rankedSearch(items, query, fields, limit, options);
  const records = matches.map((m) => m.record);
  RANKINGS.set(records, matches as unknown as SearchMatch<never>[]);
  return records;
}

/** The matches `rankedRecords` produced for exactly this list, when still true of it. */
export function rankingOf<T>(records: T[]): SearchMatch<T>[] | undefined {
  const matches = RANKINGS.get(records) as SearchMatch<T>[] | undefined;
  if (matches === undefined || matches.length !== records.length) return undefined;
  return records.every((r, i) => r === matches[i]!.record) ? matches : undefined;
}

/**
 * The excerpt for a record's best field: the first value of that field holding a
 * query term, cut by `makeExcerpt` around the densest cluster of hits. Hits are
 * thinned evenly past MAX_EXCERPT_HITS so a record saying "data" three hundred
 * times costs what one saying it ten times does, without moving the cluster.
 */
function excerptFor<T>(
  record: T,
  field: SearchField<T>,
  terms: { has(term: string): boolean },
): { excerpt: string; chars: number } {
  const raw = field.get(record);
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  for (const value of values) {
    let hits = analyze(value).filter((w) => terms.has(w.term)).map((w) => w.at);
    if (hits.length === 0) continue;
    if (hits.length > MAX_EXCERPT_HITS) {
      const step = Math.ceil(hits.length / MAX_EXCERPT_HITS);
      hits = hits.filter((_, i) => i % step === 0);
    }
    return { excerpt: makeExcerpt(value, hits), chars: value.length };
  }
  const first = values[0] ?? "";
  return { excerpt: makeExcerpt(first, []), chars: first.length };
}

// --- Per-surface field sets -------------------------------------------------

/** URI-ish queries ("regulation://crr/180", "crr/180") may match on `id`. */
const looksUriLike = (query: string): boolean => query.includes("://") || query.includes("/");

// Module constants, not rebuilt per call: the index is cached on the field
// objects, so a field set rebuilt on every query would be indexed on every query.
//
// `heading_path` leads. The words a validator searches by sit in a heading
// ("Representativeness of the data") far more often than in the paragraphs
// beneath it, and before this field existed they could not be searched at all.
const REGULATION_FIELDS: SearchField<Regulation>[] = [
  { name: "heading_path", weight: 3, get: (r) => r.heading_path },
  { name: "citation", weight: 2, get: (r) => r.citation },
  { name: "text", weight: 1, get: (r) => r.text },
  { name: "commentary", weight: 0.3, get: (r) => r.commentary.map((c) => c.text) },
];
const REGULATION_FIELDS_WITH_ID: SearchField<Regulation>[] = [
  ...REGULATION_FIELDS,
  { name: "id", weight: 0.5, get: (r) => r.id },
];

/**
 * Regulation fields depend on the query: `id` participates (at low weight)
 * only when the query looks URI-like, so prose queries like "regulation"
 * no longer match every record through its URI scheme.
 */
export function regulationSearchFields(query: string): SearchField<Regulation>[] {
  return looksUriLike(query) ? REGULATION_FIELDS_WITH_ID : REGULATION_FIELDS;
}

/** What a regulation search covers: the default leaves background material out. */
export type SearchScope = "default" | "all";

/**
 * Regulation priors, in one place so every caller ranks alike.
 *
 * - `role: background` is left out unless the caller asks for `scope: "all"`:
 *   consultation feedback and background discussion are about the law, and on
 *   an open question they outrank it by being long and by saying the question's
 *   words more often than the paragraph that answers it.
 * - A `section` is an outline node. It is a heading, not a requirement, so it
 *   ranks at about a third of an operative record that matches as well.
 * - A scope/definitions boilerplate record (`is_metadata_only`) at half.
 */
export function regulationRanking(opts: {
  scope?: SearchScope | undefined;
  glossary?: Glossary | undefined;
}): RankOptions<Regulation> {
  return {
    glossary: opts.glossary,
    exclude: opts.scope === "all" ? undefined : (r) => r.role === "background",
    prior: (r) => (r.kind === "section" ? 0.35 : 1) * (r.is_metadata_only === true ? 0.5 : 1),
  };
}

export const testSearchFields: SearchField<Test>[] = [
  { name: "name", weight: 3, get: (t) => t.name },
  { name: "aliases", weight: 3, get: (t) => t.aliases },
  { name: "family", weight: 2, get: (t) => t.family },
  { name: "purpose", weight: 2, get: (t) => t.purpose },
  { name: "acceptance_criteria", weight: 1, get: (t) => t.acceptance_criteria },
];

export const checkSearchFields: SearchField<Check>[] = [
  { name: "name", weight: 3, get: (c) => c.name },
  { name: "expectation", weight: 2, get: (c) => c.expectation },
  { name: "expected_evidence", weight: 1, get: (c) => c.expected_evidence },
];

export const playbookSearchFields: SearchField<Playbook>[] = [
  { name: "area", weight: 3, get: (p) => p.area },
  { name: "subarea", weight: 3, get: (p) => p.subarea },
  { name: "phase_names", weight: 2, get: (p) => p.phases.map((ph) => ph.name) },
  { name: "phase_descriptions", weight: 1, get: (p) => p.phases.map((ph) => ph.description) },
];

export const sourceSearchFields: SearchField<Source>[] = [
  { name: "title", weight: 3, get: (s) => s.title },
  { name: "document_id", weight: 2, get: (s) => s.document_id },
  { name: "framework", weight: 1, get: (s) => s.framework },
  { name: "notes", weight: 1, get: (s) => s.notes },
];
