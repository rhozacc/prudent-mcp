// Citation tokens: the normaliser and the spine helpers every other citation module reads.
// Common citation abbreviations, expanded during normalization so
// "Art. 178(1)(a)" and "CRR Article 178(1)(a)" normalize into comparable forms.
export const CITATION_EXPANSIONS: Record<string, string> = {
  art: "article",
  arts: "articles",
  par: "paragraph",
  para: "paragraph",
  paras: "paragraphs",
  gl: "guidelines",
};

export function citationTokens(text: string): string[] {
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
export const STRUCTURAL = new Set([
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

export const withoutConnectives = (tokens: string[]): string[] => tokens.filter((t) => !CONNECTIVES.has(t));

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
export const spineOf = (tokens: string[]): string[] =>
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
export const spineIsFaithful = (tokens: string[]): boolean =>
  tokens.every((t) => !/\d/.test(t) || /^\d+[a-z]{0,2}$/.test(t));

export const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export const startsWithTokens = (haystack: string[], prefix: string[]): boolean =>
  prefix.length < haystack.length && prefix.every((v, i) => v === haystack[i]);

/** Index of `window` as a contiguous run in `tokens`, or -1. */
export function windowAt(tokens: string[], window: string[]): number {
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
