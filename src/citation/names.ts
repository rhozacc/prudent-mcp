// How a document is named in a citation: identifiers, filler words, unplaced names.
import { STRUCTURAL, windowAt } from "./tokens.ts";

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
export const unexplainedWords = (tokens: string[]): string[] =>
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
export function unrecognisedNameTail(tokens: string[]): string[] | null {
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
export function unplacedIdentifier(text: string, rest: string[]): string | null {
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
