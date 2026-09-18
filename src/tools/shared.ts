/**
 * Shared tool plumbing — result envelopes, annotations, and input leniency.
 *
 * Conventions enforced here (and documented in the server instructions):
 *   - every tool is read-only/idempotent/closed-world, declared via annotations;
 *   - successful structured results return BOTH structuredContent and a JSON
 *     text fallback (the spec requires text alongside structured content);
 *   - misses are isError results with a next-step pointer, never the string
 *     "null";
 *   - search tools share one envelope: { results, total_matches, offset,
 *     truncated } with a text hint when truncated.
 */
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
    notice: z.string().optional().describe("Guidance about this result set, when there is any."),
  }).passthrough();
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
