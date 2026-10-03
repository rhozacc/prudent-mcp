/**
 * Shared tool plumbing — result envelopes, annotations, input leniency, and the
 * one as_of resolution the regulation tools share.
 *
 * Conventions enforced here (and documented in the server instructions):
 *   - every tool is read-only/idempotent/closed-world, declared via annotations;
 *   - successful structured results return BOTH structuredContent and a JSON
 *     text fallback (the spec requires text alongside structured content);
 *   - misses are isError results with a next-step pointer, never the string
 *     "null";
 *   - search tools share one envelope: { results, total_matches, offset,
 *     truncated } with a text hint when truncated;
 *   - a regulation served under as_of from its CURRENT text says so
 *     (`as_of_note`), because the record alone cannot.
 */
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { computeHoldings, missingRecordClause } from "../holdings.ts";
import type { Regulation, RegulationId } from "../schema.ts";
import { distinctQueryTokens, rankedSearch, type SearchField, type SearchMatch } from "../search.ts";

// Every tool on this server reads a local knowledge base and nothing else.
export const READ_ONLY_HINTS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

// --- Result builders --------------------------------------------------------

type TextBlock = { type: "text"; text: string };

const textBlock = (text: string): TextBlock => ({ type: "text", text });

/**
 * The one serializer for every tool response body.
 *
 * Compact, not indented. Indentation is for humans reading a file; a tool
 * response is read by a model that pays for every character, and pretty-printing
 * a nested payload costs 30-45% more for information the JSON already carries.
 * It is also the serializer the size ceilings measure with, so a budget cannot
 * be computed against one encoding and the wire carry another — which is how a
 * response shortened to fit 24,000 characters arrived as 35,338.
 */
export const serialize = (value: unknown): string => JSON.stringify(value);

/** Success with structured content plus the JSON text fallback. */
export function ok(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [textBlock(serialize(structured))],
    structuredContent: structured,
  };
}

/** Success as plain JSON text (tools without an output schema). */
export function okText(value: unknown): CallToolResult {
  return { content: [textBlock(serialize(value))] };
}

/** Miss / bad input: an isError result carrying a next-step pointer. */
export function miss(message: string): CallToolResult {
  return { content: [textBlock(message)], isError: true };
}

/**
 * The miss for a regulation id the corpus does not hold - ONE sentence for
 * get_regulation, expand_regulation and get_regulation_tree. "No record for X"
 * alone is true and reads as "there is no X": the corpus holds some provisions
 * of a document, not all of them, and which kind of absence this is depends on
 * how much of that document was taken (src/holdings.ts). Computed from the
 * adapters' own lists so an outside adapter with no `info().holdings` gets it too.
 */
export async function unknownRegulationMiss(id: string): Promise<CallToolResult> {
  const [regulations, sources] = await Promise.all([adapters.regulation.list(), adapters.source.list()]);
  const why = missingRecordClause(regulations, computeHoldings(regulations, sources), id);
  return miss(`No record for ${id}. ${why} Verify the id with search_regulation or list_review_areas.`);
}

// --- Search envelope ---------------------------------------------------------

export interface SearchEnvelope<T> {
  results: T[];
  /** Rows in THIS page. Distinct from total_matches, which is the whole set. */
  returned: number;
  /**
   * Every match the query found, not the size of this page. The adapter used to
   * cap at 20 before this was computed, so the figure was a page size wearing a
   * total's name — and a caller who paged past it got an empty set, which reads
   * as confirmation that everything has been seen.
   */
  total_matches: number;
  offset: number;
  truncated: boolean;
  /** Next offset to ask for; null when this page is the last one. */
  next_offset: number | null;
  /**
   * Distinct meaningful terms in the query (stopwords excluded exactly as
   * ranking excludes them): the denominator every row's `coverage` is read
   * against.
   */
  query_tokens?: number;
  /**
   * The highest `coverage` over the WHOLE ranked set, not this page - so page 2
   * still says how good the best hit was. Absent when no row matched.
   */
  best_coverage?: number;
  /** Guidance that used to be appended after the JSON, where it broke parsing. */
  notice?: string;
}

/**
 * Serialized-size ceiling for one tool response, in characters.
 *
 * ~6,000 tokens at the chars/4 proxy. It exists because page size and payload
 * size are not the same quantity: 20 concise rows cost a couple of thousand
 * tokens, 20 rows of `detail: 'full'` regulation cost sixty thousand — a fifth
 * of a working context spent on one call, most of it never read. The page is
 * shortened to fit and `next_offset` carries on from where it stopped, so
 * nothing becomes unreachable; only the size of a single response is bounded.
 */
export const RESPONSE_CHAR_BUDGET = 24_000;

/**
 * Page `all` (already ranked) into the shared search envelope, then shorten the
 * page until the serialized rows fit `budget`.
 *
 * At least one row is always returned: a caller that asked for a record and got
 * an empty page cannot tell "too big" from "no matches", and the second is a
 * different answer. An oversized single row is served with a notice instead.
 */
export function paginate<T>(
  all: T[],
  limit: number,
  offset: number,
  budget: number = RESPONSE_CHAR_BUDGET,
): SearchEnvelope<T> {
  let results = all.slice(offset, offset + limit);
  const asked = results.length;
  while (results.length > 1 && serialize(results).length > budget) {
    // Halve rather than step: a 60,000-char page would otherwise re-serialize
    // nineteen times to find its size.
    results = results.slice(0, Math.max(1, Math.floor(results.length / 2)));
  }
  const shortened = results.length < asked;
  const truncated = offset + results.length < all.length;
  const envelope: SearchEnvelope<T> = {
    results,
    returned: results.length,
    total_matches: all.length,
    offset,
    truncated,
    next_offset: truncated ? offset + results.length : null,
  };
  if (shortened) {
    envelope.notice =
      `Showing ${results.length} of ${all.length} matches — the page was shortened from ${asked} ` +
      `rows to keep this response under ~${Math.round(budget / 4)} tokens. Pass offset: ` +
      `${envelope.next_offset} for the next rows, or use detail: 'concise' to fit more per call.`;
  } else if (truncated) {
    envelope.notice = `Showing ${results.length} of ${all.length} matches. Pass offset: ${envelope.next_offset} for the next page, or narrow the query.`;
  }
  return envelope;
}

/**
 * Envelope → CallToolResult.
 *
 * The body is the JSON and nothing else. A truncation hint used to be appended
 * as a second text block, which concatenated into the content a client reads
 * and left it unparseable; it now travels as `notice` inside the envelope.
 */
export function searchResult<T>(envelope: SearchEnvelope<T>): CallToolResult {
  const content: TextBlock[] = [textBlock(serialize(envelope))];
  return { content, structuredContent: envelope as unknown as Record<string, unknown> };
}

// --- Search coverage -----------------------------------------------------------

/**
 * The sentence added to `notice` when even the best hit leaves most of the
 * query unmatched.
 *
 * It exists because a page of twenty hits on the commonest query terms looks the
 * same whether or not any hit is about the distinctive ones: "Showing 20 of N
 * matches" for a concept the corpus does not hold. The ranking knew how many
 * terms each hit matched and kept it to itself. No relevance floor and no cap
 * come with it - every match is still returned, in the same order; the notice
 * only says what the best of them is worth, and that the shortfall is a fact
 * about this corpus, not about the law.
 */
export function weakMatchNotice(best: number, queryTokens: number): string {
  if (best === 0) {
    // Coverage counts whole-word matches only; a record can be placed on a
    // partial-word match alone (a stem) and carry coverage 0. That is not "matches
    // none of the terms" - say what was actually found.
    return (
      `No result contains any of the query's ${queryTokens} meaningful terms as a whole word; the matches are ` +
      "partial-word matches only, so they may not be about the topic. Absence of a strong match is a " +
      "statement about the corpus, not about the law."
    );
  }
  return (
    `The best result matches only ${best} of the query's ${queryTokens} meaningful terms, so the topic ` +
    "may not be in this corpus. Absence of a strong match is a statement about the corpus, not about the law."
  );
}

/**
 * Add `query_tokens` and `best_coverage` to a paged envelope and, when the best
 * match is weak (fewer than half the query's terms), say so in `notice` after
 * whatever truncation or shortening notice is already there - never instead of it.
 * A single-term query never carries it: with one term there is no "some of the
 * terms" to be short of, and a stem that places records on partial-word matches
 * alone has best coverage 0 (coverage counts whole words) without being weak.
 */
export function withQueryCoverage<T>(
  envelope: SearchEnvelope<T>,
  queryTokens: number,
  bestCoverage: number | undefined,
): SearchEnvelope<T> {
  const out: SearchEnvelope<T> = { ...envelope, query_tokens: queryTokens };
  if (bestCoverage === undefined) return out;
  out.best_coverage = bestCoverage;
  if (queryTokens >= 2 && bestCoverage * 2 < queryTokens) {
    const weak = weakMatchNotice(bestCoverage, queryTokens);
    out.notice = envelope.notice === undefined ? weak : `${envelope.notice} ${weak}`;
  }
  return out;
}

export interface RankedSearchPage<T extends { id: string }, Row extends object> {
  /** What the adapter's `search(query)` returned, in the order it returned it. */
  records: T[];
  query: string;
  fields: SearchField<T>[];
  detail: "concise" | "full";
  limit: number;
  offset: number;
  /** The concise projection; `match` is undefined for a record the local ranking did not place. */
  concise: (record: T, match: SearchMatch<T> | undefined) => Row;
  /** The `detail: 'full'` row; the record itself when omitted. */
  full?: (record: T) => object;
}

/**
 * The one body of a search_* tool: page the adapter's records, decorate concise
 * rows with `coverage`, and report the query-level figures.
 *
 * The adapter interface returns records and not matches, so ranking is recomputed
 * here over the result set (cheap at these sizes) with the same field set the
 * adapter used. Coverage is therefore the server's own definition, and the best
 * is taken over every ranked record before paging. Row order is the adapter's,
 * untouched. `detail: 'full'` rows are record schemas and stay undecorated; the
 * envelope fields still appear. Rows are decorated BEFORE paginate so the size
 * budget measures what is actually sent.
 */
export function rankedSearchResult<T extends { id: string }, Row extends object>(
  page: RankedSearchPage<T, Row>,
): CallToolResult {
  const { records, query, fields, detail, limit, offset } = page;
  const ranked = rankedSearch(records, query, fields);
  const byId = new Map(ranked.map((m) => [m.record.id, m]));
  const rows: object[] =
    detail === "full"
      ? records.map((r) => (page.full === undefined ? r : page.full(r)))
      : records.map((r) => {
          const match = byId.get(r.id);
          const row = page.concise(r, match);
          return match === undefined ? row : { ...row, coverage: match.coverage };
        });
  // Highest of the whole ranked set, taken before paging.
  const best = ranked.reduce<number | undefined>((b, m) => (b === undefined || m.coverage > b ? m.coverage : b), undefined);
  return searchResult(withQueryCoverage(paginate(rows, limit, offset), distinctQueryTokens(query), best));
}

/**
 * Size guard for a single non-paged response.
 *
 * `detail: 'full'` on a bundling tool has no natural page to shorten — one call
 * can embed hundreds of complete records, and on a real corpus that reached
 * ~144,000 tokens, which is not a response but an eviction of whatever the
 * caller was working on. So the full form is served when it fits and the
 * compact form when it does not, with a notice saying what happened and which
 * tool fetches the parts. Never a silent truncation: a bundle that quietly
 * dropped records would be read as the whole area.
 */
export function fitOrCompact<F extends Record<string, unknown>, C extends Record<string, unknown>>(
  full: F,
  compact: () => C,
  notice: (approxTokens: number) => string,
  budget: number = RESPONSE_CHAR_BUDGET,
): Record<string, unknown> {
  const chars = serialize(full).length;
  if (chars <= budget) return full;
  return { ...compact(), notice: notice(Math.round(chars / 4)) };
}

/** The shared input shape for the four search_* tools. */
export function searchInputShape(fieldsDoc: string) {
  return {
    query: z
      .string()
      .min(2)
      .describe(`Search phrase, at least 2 characters — ranked, field-scoped search over ${fieldsDoc}. Empty/one-char queries are rejected; enumeration is not search's job.`),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Page size (default 20, max 100)."),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Skip this many ranked matches — raise to page through results."),
    detail: z
      .enum(["concise", "full"])
      .default("concise")
      .describe("concise (default): per-surface projection; full: complete records."),
  };
}

/** Documented once, spread into each concise hit schema. */
export const rowCoverageShape = {
  coverage: z
    .number()
    .int()
    .optional()
    .describe("How many of the query's meaningful terms (query_tokens) this row matched."),
};

/**
 * The shared output schema for the four search_* tools.
 *
 * `.passthrough()` is load-bearing, not tidiness. The SDK publishes a declared
 * output schema with `additionalProperties: false`, so a client that validates
 * structured content REJECTS any response carrying a key the schema does not
 * name. That makes every future additive field — a document stamp, a coverage
 * note, a per-row provenance marker — a breaking change for exactly the callers
 * who are strictest about correctness. Opening the envelope first means later
 * fields are additive in fact and not only in intent.
 *
 * It does not weaken anything: the handler still builds the body, and the named
 * keys below are still typed and still required.
 */
export function searchOutputShape(resultItem: z.ZodTypeAny) {
  return z.object({
    results: z.array(resultItem).describe("One page of ranked matches, best first."),
    returned: z.number().int().describe("Rows in this page."),
    total_matches: z
      .number()
      .int()
      .describe("Every match the query found across the surface — not the size of this page."),
    offset: z.number().int(),
    truncated: z.boolean().describe("True when matches exist beyond this page."),
    next_offset: z
      .number()
      .int()
      .nullable()
      .describe("Offset for the next page; null when this page is the last."),
    query_tokens: z
      .number()
      .int()
      .optional()
      .describe("Distinct meaningful terms in the query (stopwords excluded) - the denominator for each row's coverage."),
    best_coverage: z
      .number()
      .int()
      .optional()
      .describe(
        "Highest coverage of any match across the whole ranked set, not only this page; absent when nothing matched.",
      ),
    notice: z.string().optional().describe("Guidance about this result set, when there is any."),
  }).passthrough();
}

// --- as_of: say when the current text stands in for a historical one -----------

/** A regulation as resolved for a tool, and whether `as_of` was answered from its current text. */
export interface ServedRegulation {
  record: Regulation | null;
  /**
   * True only when the adapter REPORTED that the current record was served
   * because no version is recorded for the date. An adapter that cannot say
   * (no `resolveAsOf`) yields false: unknown is not asserted as a substitution,
   * and the tools behave as they did before the method existed.
   */
  fromCurrent: boolean;
  /**
   * True only when `as_of` was given, no version was found for the date
   * (`record` is null), and the corpus nevertheless holds the id's current
   * record. That is a gap in the recorded history - the provision is listed in
   * the corpus, it just has nothing for the date - which a dangling reference
   * (an id the corpus does not hold at all) is not. A root miss is told apart
   * from a dangling id the same way; a child or tree node needs the same
   * distinction, or it comes back as a bare id and reads as a broken link.
   */
  noVersion: boolean;
  /** The `as_of_note` for this one record; undefined unless `fromCurrent`. */
  note: string | undefined;
}

/**
 * The one way the regulation tools read a record, so `get_regulation`,
 * `expand_regulation` and every node of `get_regulation_tree` agree on what
 * "served from current text" means.
 */
export async function resolveRegulation(id: RegulationId, asOf: string | undefined): Promise<ServedRegulation> {
  const adapter = adapters.regulation;
  // Asked once, only for a miss under a date: does the corpus hold the id at all?
  const gap = async (): Promise<boolean> => asOf !== undefined && (await adapter.get(id)) !== null;
  if (asOf === undefined || adapter.resolveAsOf === undefined) {
    const record = await adapter.get(id, asOf);
    return { record, fromCurrent: false, noVersion: record === null && (await gap()), note: undefined };
  }
  const resolved = await adapter.resolveAsOf(id, asOf);
  if (resolved.record === null) return { record: null, fromCurrent: false, noVersion: await gap(), note: undefined };
  const fromCurrent = resolved.basis === "current";
  return {
    record: resolved.record,
    fromCurrent,
    noVersion: false,
    note: fromCurrent ? asOfNote(resolved.record, asOf) : undefined,
  };
}

const versionOf = (r: Regulation): string => (r.document_version.trim() === "" ? "blank" : r.document_version);

/**
 * The statement that goes with a record served from current text under `as_of`.
 *
 * It exists because the failure is invisible from inside the record: today's
 * text asked for under a past date is byte-for-byte what a historical version
 * would look like, so a validator asking what applied at an approval date, and
 * the model relaying the answer, both read it as the text of that date. It says
 * what the corpus lacks, which version it served instead (by the field that
 * names it), and what not to do with the result.
 */
export function asOfNote(record: Regulation, asOf: string): string {
  return (
    `This corpus records no version of this provision for the requested as_of date (${asOf}). ` +
    `The text served is the version named in document_version (${versionOf(record)}), which may differ from ` +
    "the text in force on that date. Do not present it as the historical text."
  );
}

/**
 * Where a group of records shares one envelope: a tree (every node reached by
 * the walk) or an expansion (the regulation children embedded under one record).
 */
export type AsOfGroup = "tree" | "children";

/** The other members of a group, by what became of them under the requested date. */
export interface AsOfGroupCounts {
  /** Served from their current text, because no version is recorded for the date. */
  fromCurrent: number;
  /** Listed by the corpus but with no version for the date, so shown by id alone. */
  noVersion: number;
}

/**
 * The same statement for a group, where one envelope covers many records.
 *
 * Nodes other than the root are not given a field each: a tree can reach 200 of
 * them, and the same sentence 200 times is the cost the note exists to avoid.
 * They are counted in the one note instead - both the ones served from current
 * text and the ones with nothing to serve, which come back as a bare id and
 * would otherwise read as a dangling reference. Returns undefined when nothing
 * in the group needs saying - no note, rather than an empty one.
 */
export function asOfGroupNote(
  asOf: string,
  root: { record: Regulation; fromCurrent: boolean },
  others: AsOfGroupCounts,
  group: AsOfGroup = "tree",
): string | undefined {
  const parts = [currentTextPart(asOf, root, others.fromCurrent, group), noVersionPart(asOf, others.noVersion, group)];
  const said = parts.filter((p): p is string => p !== undefined);
  return said.length === 0 ? undefined : said.join(" ");
}

/** The members, and the root, served from current text. */
function currentTextPart(
  asOf: string,
  root: { record: Regulation; fromCurrent: boolean },
  n: number,
  group: AsOfGroup,
): string | undefined {
  if (!root.fromCurrent && n === 0) return undefined;
  if (n === 0) return asOfNote(root.record, asOf);
  const detail = "(detail: 'full' shows each one's document_version)";
  const tree = group === "tree";
  // "2 other provisions in this tree" / "2 of its children": the same count, said
  // in the words that fit what the group is.
  const others = tree ? (n === 1 ? "1 other provision" : `${n} other provisions`) : n === 1 ? "1 of its children" : `${n} of its children`;
  if (root.fromCurrent) {
    return (
      `${asOfNote(root.record, asOf)} The same holds for ${others}${tree ? " in this tree" : ""}: ` +
      `${n === 1 ? "it was" : "each was"} served from its current text, which may differ from the text in force on that date ${detail}.`
    );
  }
  const subject = tree
    ? `${n === 1 ? "1 provision" : `${n} provisions`} in this tree other than the root`
    : `${n === 1 ? "1 child" : `${n} children`} of this provision`;
  return (
    `${subject} ${n === 1 ? "was" : "were"} served from current text, because this corpus records no version of ` +
    `${n === 1 ? "it" : "them"} for the requested as_of date (${asOf}). ` +
    `${n === 1 ? "It" : "Each"} may differ from the text in force on that date; do not present ` +
    `${n === 1 ? "it" : "them"} as the historical text ${detail}.`
  );
}

/**
 * The members the corpus lists but has no version of for the date. They carry no
 * label and no text, which is exactly what a reference to a record that is not in
 * the corpus looks like, so the note says which of the two this is - and that it
 * is a statement about the corpus's history, never about the law.
 */
function noVersionPart(asOf: string, m: number, group: AsOfGroup): string | undefined {
  if (m === 0) return undefined;
  const one = m === 1;
  const subject =
    group === "tree"
      ? `${one ? "1 provision" : `${m} provisions`} in this tree other than the root`
      : `${one ? "1 child" : `${m} children`} of this provision`;
  const shown =
    group === "tree"
      ? `${one ? "it appears" : "they appear"} by id only, with no label or text, and the walk goes no further there`
      : `${one ? "it is" : "they are"} listed by id only, with no label or text`;
  return (
    `${subject} ${one ? "has" : "have"} no recorded version for the requested as_of date (${asOf}), so ${shown}. ` +
    `That is a gap in what this corpus records, not evidence that ${one ? "it" : "they"} did not exist or did not apply on that date.`
  );
}

/**
 * The tail every as_of miss shares. A miss is the one answer that carries no
 * text, so it says what the same call does elsewhere: a date the corpus holds no
 * version for is answered with the current text AND an as_of_note, not refused.
 * Without that the miss reads as "as_of is unsupported" and a caller drops the
 * date, which loses the note too.
 */
export const AS_OF_MISS_CONTEXT =
  "Where the corpus records no version for a date but the document already existed, the current text is " +
  "served together with an as_of_note; this date is earlier than anything the corpus records for it.";

/**
 * Attach `as_of_note` to a response body, leading it so the caveat is read
 * before the text it qualifies. With no note the body is returned untouched —
 * the key is absent, never present and empty (absent is not empty).
 */
export function withAsOfNote<T extends Record<string, unknown>>(
  body: T,
  note: string | undefined,
): T | (T & { as_of_note: string }) {
  return note === undefined ? body : { as_of_note: note, ...body };
}

// --- Input leniency ----------------------------------------------------------

// Models routinely wrap IDs in quotes/brackets or leave trailing punctuation.
// No valid corpus URI starts or ends with any of these characters, so
// stripping them at the edges is safe and cheap.
const EDGE_NOISE = /^[\s"'<>()[\]{}`.,;:]+|[\s"'<>()[\]{}`.,;:]+$/g;

/** Strip quote/bracket/punctuation noise from the edges of an id-ish string. */
export function stripEdgeNoise(value: string): string {
  return value.replace(EDGE_NOISE, "");
}

/**
 * Wrap an id (or slug) schema so surrounding whitespace/quotes/punctuation are
 * tolerated before validation. Serialized to clients as the inner schema
 * (zod-to-json-schema renders effects with the input strategy as the wrapped
 * schema for preprocess).
 */
export function lenient<T extends string>(schema: z.ZodType<T>): z.ZodType<T> {
  return z.preprocess(
    (v) => (typeof v === "string" ? stripEdgeNoise(v) : v),
    schema,
  ) as unknown as z.ZodType<T>;
}

// --- Projection helpers --------------------------------------------------------

/** First sentence of a prose field, capped at ~240 chars, for concise projections. */
export function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const sentence = (match !== null ? match[0] : text).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}
