// Does a container's text carry the point a citation names? (`textCarriesPoint`, the ONE reader.)
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
