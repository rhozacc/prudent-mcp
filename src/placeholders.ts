/**
 * Pre-adoption placeholders - the ONE definition of what one looks like.
 *
 * A guideline written before the technical standard it leans on was adopted
 * cannot cite it, so it names it with a placeholder act number: "Regulation (EU)
 * xx/xx [RTS on ...]". Served verbatim that reads as a citation, but it cites
 * nothing: there is no such regulation to look up, and the instrument that later
 * took the slot carries a real number the text never states. The instructions
 * already tell a model to say such references are unresolved; nothing in the
 * record said it contains one, so a model had to notice the shape unprompted.
 *
 * Computed from the text the corpus already serves, never authored, so every
 * corpus gets it without re-extraction. The scan is deliberately narrow:
 * an instrument KIND ("Regulation", "Directive", "Decision", "Guideline"), the
 * optional "(EU)" and "No", and an act number in which at least one half is a
 * placeholder. A numbered act ("2021/930", "575/2013") never triggers it - both
 * halves are digits - and neither does a bare "xx" or an ellipsis in prose
 * (a quotation elided with "[...]" is not an act number, because nothing in
 * front of it names an instrument). A false flag here is a claim that a real
 * citation is not one, which is as wrong as the omission it repairs.
 *
 * Not covered, on purpose: a placeholder for a guideline's OWN reference number
 * (a "GL/201x/xx"-style reference in a notification instruction) - it is not an act number and
 * names no other instrument.
 */

/** One half of an act number that is a stand-in: xx, XXXX, 20xx, 201x, [...], […]. */
const PLACEHOLDER_HALF = String.raw`(?:[xX]{2,4}|(?:19|20)(?:\d[xX]|[xX]{1,2})|\[\s*(?:\.{2,}|…)\s*\])`;
const NUMBER_HALF = String.raw`(?:${PLACEHOLDER_HALF}|\d{1,4})`;

/**
 * Kind, optional "(EU)"/"(EC)"/"(Euratom)", optional "No"/"No.", then the number
 * as two halves around a slash (either era: serial/YEAR or YEAR/serial), then
 * the bracketed descriptor drafters add after it ("[RTS on ...]") when there is
 * one - the only thing in the text that says WHICH instrument is meant.
 */
const PLACEHOLDER_ACT = new RegExp(
  String.raw`\b(?:regulation|directive|decision|guideline)\s*(?:\((?:eu|ec|euratom)\)\s*)?(?:no\.?\s*)?` +
    String.raw`(${NUMBER_HALF})\s*\/\s*(${NUMBER_HALF})(?![A-Za-z0-9])(?:\s*\[[^\]\n]{1,80}\])?`,
  "gi",
);

const IS_PLACEHOLDER = new RegExp(`^${PLACEHOLDER_HALF}$`);

/** How many spans a record carries, and how long each may be. */
export const MAX_PLACEHOLDER_SPANS = 3;
export const MAX_PLACEHOLDER_SPAN_CHARS = 120;

export interface PreAdoptionPlaceholders {
  /** The matched spans, in order of appearance, distinct, at most MAX_PLACEHOLDER_SPANS. */
  spans: string[];
  /** How many distinct placeholders the text holds; larger than spans.length when the list was cut. */
  total: number;
}

/**
 * The pre-adoption placeholders in a text, or null when there are none.
 *
 * Null rather than an empty result so "absent" and "none found" cannot be
 * confused by a caller that spreads the result into a body.
 */
export function preAdoptionPlaceholders(text: string): PreAdoptionPlaceholders | null {
  const seen = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_ACT)) {
    const [whole, first, second] = m;
    if (first === undefined || second === undefined) continue;
    // Both halves digits is a numbered act; only a stand-in half makes a placeholder.
    if (!IS_PLACEHOLDER.test(first.trim()) && !IS_PLACEHOLDER.test(second.trim())) continue;
    const span = whole.replace(/\s+/g, " ").trim();
    seen.add(span.length > MAX_PLACEHOLDER_SPAN_CHARS ? `${span.slice(0, MAX_PLACEHOLDER_SPAN_CHARS - 1)}…` : span);
  }
  if (seen.size === 0) return null;
  return { spans: [...seen].slice(0, MAX_PLACEHOLDER_SPANS), total: seen.size };
}

/**
 * What the notice says. It states what the placeholder is and is not, and what a
 * reader may do with it; it does not assert that the instrument is absent from
 * the corpus, because the corpus may well hold it under its adopted number.
 */
export function placeholderNotice(found: PreAdoptionPlaceholders): string {
  const cut =
    found.total > found.spans.length
      ? ` The text holds ${found.total} such references; the first ${found.spans.length} are listed.`
      : "";
  return (
    "This text refers to an instrument by a pre-adoption placeholder; the placeholder is not a citation. " +
    "The instrument may be identified elsewhere in this library or not at all. " +
    "Do not present it as the current state of the law." +
    cut
  );
}

/**
 * Attach the flag to a regulation response body, leading it (like `as_of_note`)
 * so the caveat is read before the text it qualifies. A text without a
 * placeholder returns the body untouched: the keys are absent, never present and
 * empty (absent is not empty).
 *
 * Applied to a single served record (get_regulation, expand_regulation), never to
 * a `detail: 'full'` search row: those rows ARE the canonical record schema and
 * stay unmodified, and the flag is one get_regulation away. Embedded children of
 * an expansion are not scanned either - the flag speaks for the record asked for.
 */
export function withPlaceholderFlag<T extends { text: string }>(
  body: T,
): T | (T & { pre_adoption_placeholders: string[]; notice?: string; placeholder_notice?: string }) {
  const found = preAdoptionPlaceholders(body.text);
  if (found === null) return body;
  // A body that already carries a `notice` of its own keeps it; ours then travels
  // as `placeholder_notice`, so neither statement overwrites the other.
  const key = "notice" in body ? "placeholder_notice" : "notice";
  return { pre_adoption_placeholders: found.spans, [key]: placeholderNotice(found), ...body };
}
