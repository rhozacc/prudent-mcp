/**
 * The language rule: what server-authored text may not say.
 *
 * A model repeats the server's own words to the person it is answering. When the
 * words are the server's plumbing — "the corpus has this", "not ingested here",
 * "no record for" — the answer reads as a description of a tool, to a reader who
 * asked about credit-risk regulation. The rule keeps that vocabulary out of
 * every string the server writes and keeps the self-reference to one word:
 * "this library". Text names instruments, provisions and dates.
 *
 * This is the ONE definition. The eval (I17) and the unit test import it, so the
 * list cannot drift between the check and the thing it checks.
 *
 * Two registers, because the same words are not equally harmful in both:
 *
 * - MODEL-FACING text (instructions, tool and field descriptions, and the miss
 *   that tells a model what to call next) must name tools and fields to be
 *   usable, so identifiers are exempt: a snake_case name, a dotted path, or
 *   anything in backticks is an identifier and is not scanned as prose.
 * - ANSWER-BEARING text (a `notice`, a `*_note`) is written to be repeated to a
 *   user, so it may contain no identifier at all: no tool name, no field name,
 *   no backtick.
 *
 * Record text — a provision, a check, a source's own notes — is data, never
 * scanned.
 */

/**
 * Terms the server's own prose never uses. Whole words, any case. "record" and
 * "records" are banned because they describe the storage; the thing a
 * practitioner asked about is a provision, a check, a test, a playbook, a source.
 */
export const BANNED_TERMS: readonly string[] = [
  "corpus",
  "corpora",
  "ingest",
  "ingested",
  "ingesting",
  "ingestion",
  "registry",
  "record",
  "records",
  "holdings",
  "adapter",
  "adapters",
  "served",
  "this server",
];

const BANNED = new RegExp(`\\b(?:${BANNED_TERMS.map((t) => t.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

/** `` `x` ``, `snake_case_names`, `dotted.paths_like.this`: names, not prose. */
const IDENTIFIER =
  /`[^`]*`|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?:\.[a-z_][a-z0-9_]*)*\b|\b[a-z][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+\b/g;

/** Banned terms in `text`, as written, in order. Identifiers are not prose and are skipped. */
export function bannedTermsIn(text: string): string[] {
  return [...text.replace(IDENTIFIER, " ").matchAll(BANNED)].map((m) => m[0]);
}

/** Identifiers in `text`: what an answer-bearing string must not contain at all. */
export function identifiersIn(text: string): string[] {
  return [...text.matchAll(IDENTIFIER)].map((m) => m[0]);
}
