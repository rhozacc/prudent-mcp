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
 * scanned. A note that NAMES a record by its label (a citation, a check's name, a
 * title) puts the label in the library's quotation marks (`quoted`), and a
 * quotation is not scanned: the label is data, the words around it are the server's.
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

/**
 * A quotation is somebody else's words: the text of a provision a note quotes as
 * the new wording of an amendment, or the citation a caller typed and a decline
 * repeats back. The server did not write it, so the rule does not read it. The
 * delimiters are straight and curly double quotes; an apostrophe is not one.
 */
const QUOTATION = /"[^"\n]*"|“[^”\n]*”/g;

/**
 * A label taken from the library's data (a provision's citation, a check's or playbook's name, a source's title, a
 * change's title) as a note names it: inside the library's quotation marks, so the language rule leaves it alone. The
 * label is somebody else's words and may legitimately contain a word the server's own prose may not ("holdings" in
 * the name of a requirement). ONE definition: every note that names an entry quotes it through this, and the rule
 * above is what makes the quotation exempt. A quotation mark inside the label would end the quotation early, so it
 * is replaced by the single curly mark, which is not a delimiter.
 */
export const quoted = (label: string): string => `“${label.replace(/[“"]/g, "‘").replace(/”/g, "’")}”`;

/** `text` without its quotations. */
export const withoutQuotations = (text: string): string => text.replace(QUOTATION, " ");

/** Banned terms in `text`, as written, in order. Identifiers and quotations are not the server's prose and are skipped. */
export function bannedTermsIn(text: string): string[] {
  return [...withoutQuotations(text).replace(IDENTIFIER, " ").matchAll(BANNED)].map((m) => m[0]);
}

/** Identifiers in `text`: what an answer-bearing string must not contain at all. Quotations are skipped. */
export function identifiersIn(text: string): string[] {
  return [...withoutQuotations(text).matchAll(IDENTIFIER)].map((m) => m[0]);
}
