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
 *     unless they contain a digit. They matched as substrings almost everywhere
 *     ("of" inside "proof"), which both pinned the excerpt to the head of the
 *     record and handed every record a free point of coverage — the primary
 *     sort key. Filtering is by list and not by length, because a citation's
 *     point segment ("180(1)(a)") is one character and carries meaning.
 *   - Only the declared fields are scanned, each with a weight. Score = sum
 *     over tokens of `weight × occurrences`; a whole-word occurrence counts
 *     full weight, a substring-only occurrence a quarter. Only whole-word
 *     matches establish COVERAGE, so a loose match cannot outrank a record
 *     that genuinely uses the term.
 *   - Results are ordered by COVERAGE first — how many of the query's distinct
 *     tokens the record matches at all — and only then by score, ties broken
 *     by input order. So the ranking is fully deterministic.
 *
 *     Coverage exists because a pure score sum is an OR: on the real corpus
 *     "long run average default rate" matched 707 of 1,365 regulation records
 *     and "margin of conservatism data quality" matched 984 of 1,107 checks,
 *     because every record says "data" or "model" somewhere. Summing lets a
 *     record that matches only the commonest token outrank one that matches
 *     every token, which is how `search_playbooks("PD model lifecycle")` put
 *     the one playbook actually about the lifecycle in FOURTH place. Ordering
 *     by coverage first fixes that without dropping anything: a single-token
 *     query has coverage 1 everywhere, so it falls straight through to score
 *     and behaves exactly as before.
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
   * How many of the query's distinct tokens this record matched at all. The
   * primary sort key, and worth surfacing: `coverage < query_tokens` tells a
   * caller the hit is partial before it reads the excerpt and assumes
   * otherwise.
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

const isAlphanumeric = (ch: string): boolean => /[a-z0-9]/.test(ch);

/** Occurrence counts of `needle` in lowercase `haystack`, plus first index. */
function countOccurrences(
  haystack: string,
  needle: string,
): { total: number; whole: number; first: number } {
  let total = 0;
  let whole = 0;
  let first = -1;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    if (first === -1) first = i;
    total += 1;
    const before = i === 0 ? "" : haystack[i - 1]!;
    const after = i + needle.length >= haystack.length ? "" : haystack[i + needle.length]!;
    if (!isAlphanumeric(before) && !isAlphanumeric(after)) whole += 1;
    i = haystack.indexOf(needle, i + 1);
  }
  return { total, whole, first };
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

export function rankedSearch<T>(
  items: T[],
  query: string,
  fields: SearchField<T>[],
  limit: number = DEFAULT_LIMIT,
): SearchMatch<T>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const scored: Array<SearchMatch<T> & { order: number }> = [];

  items.forEach((record, order) => {
    let total = 0;
    let best: { field: string; score: number; text: string; hits: number[] } | null = null;
    // Distinct query tokens this record matches ANYWHERE, across every field.
    // Counted per record rather than per field: a record naming "downturn" in
    // its area and "LGD" in a phase description has covered both.
    const covered = new Set<string>();

    for (const field of fields) {
      const raw = field.get(record);
      if (raw === undefined) continue;
      const values = Array.isArray(raw) ? raw : [raw];

      let fieldScore = 0;
      let anchorText: string | null = null;
      let anchorHits: number[] = [];

      for (const value of values) {
        const lower = value.toLowerCase();
        const valueHits: number[] = [];
        for (const token of tokens) {
          const occ = countOccurrences(lower, token);
          if (occ.total === 0) continue;
          // Only whole-word matches establish coverage. A substring hit still
          // scores, at a discount, but must not claim the token was found:
          // coverage is the primary sort key, so a loose match that inflates it
          // outranks a record that genuinely uses the term.
          if (occ.whole > 0) covered.add(token);
          fieldScore += field.weight * (occ.whole + 0.25 * (occ.total - occ.whole));
          if (occ.first >= 0) valueHits.push(occ.first);
        }
        if (valueHits.length > 0 && anchorText === null) {
          anchorText = value;
          anchorHits = valueHits;
        }
      }

      if (fieldScore > 0 && anchorText !== null) {
        total += fieldScore;
        if (best === null || fieldScore > best.score) {
          best = { field: field.name, score: fieldScore, text: anchorText, hits: anchorHits };
        }
      }
    }

    if (total > 0 && best !== null) {
      scored.push({
        record,
        score: total,
        coverage: covered.size,
        query_tokens: tokens.length,
        matched: {
          field: best.field,
          excerpt: makeExcerpt(best.text, best.hits),
          field_chars: best.text.length,
        },
        order,
      });
    }
  });

  return scored
    .sort((a, b) => b.coverage - a.coverage || b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ record, score, coverage, query_tokens, matched }) => ({
      record,
      score,
      coverage,
      query_tokens,
      matched,
    }));
}

// --- Per-surface field sets -------------------------------------------------

/** URI-ish queries ("regulation://crr/180", "crr/180") may match on `id`. */
const looksUriLike = (query: string): boolean => query.includes("://") || query.includes("/");

/**
 * Regulation fields depend on the query: `id` participates (at low weight)
 * only when the query looks URI-like, so prose queries like "regulation"
 * no longer match every record through its URI scheme.
 */
export function regulationSearchFields(query: string): SearchField<Regulation>[] {
  const fields: SearchField<Regulation>[] = [
    { name: "citation", weight: 3, get: (r) => r.citation },
    { name: "text", weight: 2, get: (r) => r.text },
    { name: "commentary", weight: 1, get: (r) => r.commentary.map((c) => c.text) },
  ];
  if (looksUriLike(query)) fields.push({ name: "id", weight: 0.5, get: (r) => r.id });
  return fields;
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
