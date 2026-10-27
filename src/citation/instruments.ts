// Instruments named by number or identifier, and what a corpus holds of them.
import type { Regulation } from "../schema.ts";
import { idDocSegment } from "../holdings.ts";

/**
 * Instruments a citation can name, and how to recognise them in prose.
 *
 * `acts` lists the numbered-act keys that name the same instrument. The CRR is
 * "CRR", "Capital Requirements Regulation", "Regulation (EU) No 575/2013" and a
 * careless "Regulation (EU) 2013/575" alike; a gate that reads only some of those
 * tells a caller the corpus holds no CRR while it holds exactly that. Identity
 * only - what the instrument is called, never what it requires.
 */
const INSTRUMENT_PATTERNS: Array<{ key: string; re: RegExp; acts: string[] }> = [
  {
    key: "crr",
    re: /\bcrr\b|\bcapital\s+requirements\s+regulation\b|regulation\s*\(eu\)\s*(no\.?\s*)?575\s*\/\s*2013|\b575\s*\/\s*2013\b/i,
    acts: ["regulation-2013-575"],
  },
  {
    key: "crd",
    re: /\bcrd\s*(iv|v)?\b|\bcapital\s+requirements\s+directive\b|directive\s*2013\s*\/\s*36/i,
    acts: ["directive-2013-36"],
  },
];

/**
 * Could this be the YEAR half of an EU act number? The Communities began in 1958,
 * so 1907 (REACH is Regulation (EC) No 1907/2006) is a serial that merely looks
 * like a year, and a year does not run past 2099.
 */
const isYearNumber = (s: string): boolean => /^(?:19(?:5[89]|[6-9]\d)|20\d\d)$/.test(s);

/** The institution an act number names, in any of the places writers put it. */
export const ACT_TAG = String.raw`(?:eu|ec|eec|euratom)`;

/**
 * The formula an act is formally cited with, "of the European Parliament and of the
 * Council of 26 June 2013": part of the act's name, and a date that is not part of
 * any provision's number, so it has to leave the citation with the act.
 */
const ACT_FORMULA = String.raw`(?:\s+of\s+the\s+european\s+parliament\s+and\s+(?:of\s+)?(?:the\s+)?council` +
  String.raw`(?:\s+of\s+\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})?)?`;

/**
 * How an EU act is numbered in prose. Defined ONCE, because the gate
 * (`namedInstruments`) and the mention scan (`instrumentMentions`) must agree on
 * what a numbered act is, or the refusal names an instrument the scan then cannot
 * find.
 *
 * Kind, then the institution in any of its places - "(EU)", a bare "EU", or the
 * "/EU" that closes "Directive 2014/65/EU" - then the number as serial/YEAR or
 * YEAR/serial, then `ACT_FORMULA`. `guideline` is here because ECB guidelines are
 * numbered the same way ("Guideline (EU) 2017/697").
 *
 * Capture groups: 1 kind, 2 the institution before the number, 3 and 4 the two
 * halves of the number, 5 the institution after it.
 */
const NUMBERED_ACT = new RegExp(
  // Each run of white space follows a token of its own, so a long run can be split
  // between the quantifiers in only one way.
  String.raw`\b(regulation|directive|decision|guideline)s?\s*` +
    String.raw`(?:(\(${ACT_TAG}\)|${ACT_TAG}\b)\s*)?(?:no\.?\s*)?` +
    String.raw`(\d{1,4})\s*\/\s*(\d{1,4})\b` +
    String.raw`(\s*\/\s*${ACT_TAG}\b)?` +
    ACT_FORMULA,
  "gi",
);

/**
 * The same number written the other way round, the number and then the kind
 * ("575/2013 Regulation", "the 2013/36/EU Directive"): how an act is named in prose
 * that does not give its formal citation. Read by the same rules and for the same
 * reason. A gate that reads one order is walked round by the other, and then the
 * number goes on to be read as the CRR's, with the kind word - the only thing that
 * says it is not - ignored: "Article 178 of 575/2013 Directive" was answered with
 * the CRR's Article 178.
 *
 * A number that already belongs to a kind in front of it is not read again
 * (`numberedActs` keeps the kind-first reading), and a kind word that begins the
 * NEXT act ("Directive 2013/36/EU Regulation (EU) No 575/2013") is not this
 * number's kind. Not `guideline`: an EBA guideline is numbered EBA/GL/YYYY/NN and
 * a guideline's "2017/16 Guidelines" names a document, not an act.
 *
 * Capture groups: 1 and 2 the two halves of the number, 3 the institution after it
 * ("/EU"), 4 the institution in brackets, 5 the kind.
 */
const NUMBER_FIRST_ACT = new RegExp(
  // One run of white space at a time, so a long run cannot be split between
  // quantifiers in more than one way.
  String.raw`(?<![\d/])(?:no\.?\s*)?(\d{1,4})\s*\/\s*(\d{1,4})\b\s*` +
    String.raw`(\/\s*${ACT_TAG}\b\s*)?(\(${ACT_TAG}\)\s*)?` +
    String.raw`(regulation|directive|decision)s?\b` +
    String.raw`(?!\s*(?:(?:\(${ACT_TAG}\)|${ACT_TAG}\b)\s*)?(?:no\.?\s*)?\d{1,4}\s*\/\s*\d{1,4}\b)` +
    ACT_FORMULA,
  "gi",
);

export interface NumberedAct {
  /** `kind-YEAR-serial`, the same whichever numbering era or order the citation used. */
  key: string;
  /** The institution the citation wrote ("EU", "EC", "EEC", "Euratom"), when it wrote one. */
  tag?: string;
  /** Where the act is written in the text, so it can be cut out or scoped as one name. */
  start: number;
  end: number;
}

/**
 * Which half of a number is the year. Where exactly one half can be a year it is
 * that one. Where both can (2019/2033), the era decides: regulations were numbered
 * serial/YEAR until 2015 and YEAR/serial after it, and directives and decisions
 * have been YEAR/serial throughout. Where neither can, the kind decides.
 */
function yearAndSerial(kind: string, first: string, second: string): [string, string] {
  const yearFirst = kind === "directive" || kind === "decision";
  if (isYearNumber(first) && !isYearNumber(second)) return [first, second];
  if (isYearNumber(second) && !isYearNumber(first)) return [second, first];
  if (isYearNumber(first) && isYearNumber(second)) {
    return yearFirst || Number(first) >= 2015 ? [first, second] : [second, first];
  }
  return yearFirst ? [first, second] : [second, first];
}

/**
 * The numbered acts a text names, in either numbering era and in either order: the
 * kind and then the number (`NUMBERED_ACT`), or the number and then the kind
 * (`NUMBER_FIRST_ACT`). The one reader the gate and the mention scan share.
 *
 * A bare number needs more to be an act than a tagged one. "Regulation 5/2" is
 * not an act number, and neither is "Guidelines 2017/16", which is how a caller
 * names a document that is no act at all (EBA/GL/2017/16): without the
 * institution tag the number must carry a year, and a guideline needs the tag.
 */
export function numberedActs(text: string): NumberedAct[] {
  const acts: NumberedAct[] = [];
  const add = (kind: string, first: string, second: string, institution: string | undefined, start: number, end: number): void => {
    const tagged = institution !== undefined;
    if (!tagged && (kind === "guideline" || (!isYearNumber(first) && !isYearNumber(second)))) return;
    const [year, serial] = yearAndSerial(kind, first, second);
    const written = (institution ?? "").replace(/[()\s/]/g, "").toLowerCase();
    const tag = written === "" ? undefined : written === "euratom" ? "Euratom" : written.toUpperCase();
    acts.push({ key: `${kind}-${year}-${serial}`, ...(tag === undefined ? {} : { tag }), start, end });
  };
  for (const m of text.matchAll(NUMBERED_ACT)) {
    const kind = m[1]?.toLowerCase();
    if (kind === undefined || m[3] === undefined || m[4] === undefined) continue;
    add(kind, m[3], m[4], m[2] ?? m[5], m.index, m.index + m[0].length);
  }
  // The number written first. Only where no kind-first act already has those
  // characters: "Directive 2013/36/EU Regulation ..." is one act and the start of another.
  const kindFirst = acts.length;
  for (const m of text.matchAll(NUMBER_FIRST_ACT)) {
    const kind = m[5]?.toLowerCase();
    const end = m.index + m[0].length;
    if (kind === undefined || m[1] === undefined || m[2] === undefined) continue;
    if (acts.slice(0, kindFirst).some((a) => m.index < a.end && a.start < end)) continue;
    add(kind, m[1], m[2], m[3] ?? m[4], m.index, end);
  }
  return acts.sort((a, b) => a.start - b.start);
}

/** One key per instrument, whichever numbering era the citation is written in. */
export const numberedActKeys = (text: string): string[] => numberedActs(text).map((a) => a.key);

/** The key a numbered act is known by when a named instrument is the same thing. */
const canonicalInstrument = (key: string): string =>
  INSTRUMENT_PATTERNS.find((p) => p.acts.includes(key))?.key ?? key;

/**
 * A numbered EU instrument the citation names, in either numbering era.
 *
 * EU acts were numbered serial/YEAR until 2015 ("Regulation (EU) No 575/2013")
 * and YEAR/serial from 2015 on, with the "No" dropped ("Regulation (EU)
 * 2021/930"). The old pattern required a FOUR-DIGIT second number, so every act
 * adopted since 2015 with a serial under 1000 fell straight through the gate —
 * nine of the twenty-seven numbered instruments this corpus's own text names,
 * including the downturn RTS and the GDPR-shaped 2016/679.
 *
 * Falling through matters more than it sounds. The gate is the defence against
 * sourcing a same-numbered provision from a document the caller did not name;
 * skipping it sent the citation into the numeric spine rules, which is why
 * asking for 2021/930 came back "nothing in this corpus is numbered 2021.930" —
 * a malformed-citation shape, when the truth is a coverage boundary.
 *
 * The same holds for the other spellings of the same number: "Directive
 * 2014/65/EU", "Regulation EU 2019/2033", "Decision 2021/451". Each fell through
 * and had its number read as sub-points of whichever provision shared the first
 * digits.
 */
export interface NamedInstrument {
  key: string;
  /** The institution the citation wrote for a numbered act, so a refusal can quote it back rightly. */
  tag?: string;
  /** The words of the citation that name it, so a mention inside a longer name can be told apart. */
  span: string;
}

/**
 * Each place the citation names an instrument: the instruments with a name of their
 * own first, then the numbered acts.
 *
 * A name lying inside the written form of an act of ANOTHER kind is not a mention of
 * the instrument it looks like: "Directive (EC) 575/2013" carries the CRR's number
 * and is not the CRR (no directive has that number), so reading the bare number out
 * of it would hand a provision of one body of law to another.
 */
export function instrumentSpans(text: string): Array<NamedInstrument & { start: number; end: number }> {
  const acts = numberedActs(text);
  const spans: Array<NamedInstrument & { start: number; end: number }> = [];
  for (const { key, re } of INSTRUMENT_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      const start = m.index;
      const end = start + m[0].length;
      if (acts.some((a) => a.start <= start && end <= a.end && canonicalInstrument(a.key) !== key)) continue;
      spans.push({ key, span: m[0], start, end });
    }
  }
  for (const act of acts) {
    spans.push({
      key: canonicalInstrument(act.key),
      ...(act.tag === undefined ? {} : { tag: act.tag }),
      span: text.slice(act.start, act.end),
      start: act.start,
      end: act.end,
    });
  }
  return spans;
}

/**
 * Instruments this corpus does NOT hold, and what they are.
 *
 * Deliberately tiny, deliberately authored, and deliberately only about
 * IDENTITY — what kind of instrument it is and which provision empowers it.
 * Not what it requires: that is the text, the corpus does not have it, and
 * inventing it is the failure this whole file exists to prevent.
 *
 * It earns its place because the identity is the half a model gets wrong. The
 * corpus names Regulation (EU) 2021/930 in three served records and nowhere
 * says it is a regulatory technical standard, or that it was adopted under the
 * empowerment in CRR Article 181(3)(a) — so a model asked "is this the same
 * tier as the CRR?" has no served field to answer from, answers from memory,
 * and gets the hierarchy backwards. One line of curated fact, quotable against
 * a provision the corpus DOES hold, is the cheapest available fix.
 *
 * Every entry must name an empowering provision that this corpus serves, so the
 * claim is checkable rather than asserted.
 */
export const EMPOWERMENTS: Record<string, { kind: string; empoweredBy?: string; visibleAt?: string }> = {
  "regulation-2021-930": {
    kind: "a regulatory technical standard — a Commission delegated act, not a legislative one",
    empoweredBy: "Article 181(3)(a) and Article 182(4)(a) of the CRR",
    visibleAt: "regulation://crr/article-181",
  },
  "regulation-2010-1093": {
    kind:
      "the Regulation establishing the EBA; its Article 16 is the basis on which every EBA " +
      "guideline in this library is issued, and the source of their comply-or-explain effect",
    visibleAt: "regulation://crr/article-181",
  },
};

/**
 * Which served records NAME a numbered EU instrument, keyed the same way
 * `namedInstrument` keys a citation.
 *
 * The existing "way out" in the refusal below was built from `cites[].framework`
 * — a field that only ever holds `crr` and `crd` — so it could never fire for a
 * numbered act, and every instrument the corpus mentions but does not hold got
 * the emptiest possible refusal at exactly the moment a model reaches for
 * memory. This scans the served text instead, which is where the mentions
 * actually are.
 *
 * Computed, never authored: a regex over text the corpus already serves.
 */
const mentionCache = new WeakMap<object, Map<string, string[]>>();

export function instrumentMentions(regulations: Regulation[]): Map<string, string[]> {
  const cached = mentionCache.get(regulations);
  if (cached !== undefined) return cached;
  const index = new Map<string, string[]>();
  for (const r of regulations) {
    // Keyed as the gate keys the instrument it names, so "Regulation (EU) No
    // 575/2013" in a record's text is found under the CRR however the number is written.
    const seen = new Set<string>(numberedActKeys(r.text).map(canonicalInstrument));
    for (const key of seen) {
      const at = index.get(key);
      if (at === undefined) index.set(key, [r.id]);
      else at.push(r.id);
    }
  }
  mentionCache.set(regulations, index);
  return index;
}

/**
 * The ways an instrument's key can appear, squashed, in a document's ids. A numbered
 * act is looked for in both orders its number is written in ("regulation2013575"
 * and "regulation5752013"), and the CRR and CRD also by the numbers they are
 * known by, because a corpus is free to id them either way.
 */
function heldNeedles(instrument: string): string[] {
  const named = INSTRUMENT_PATTERNS.find((p) => p.key === instrument);
  return [instrument, ...(named?.acts ?? [])].flatMap((key) => {
    const m = /^([a-z]+)-(\d{2,4})-(\d+)$/.exec(key);
    return m === null ? [key.replace(/[^a-z0-9]/g, "")] : [`${m[1]}${m[2]}${m[3]}`, `${m[1]}${m[3]}${m[2]}`];
  });
}

/**
 * The documents whose framework, document id or id segment carry the instrument.
 * Asked once per mention of an instrument in a citation, so it is remembered per
 * corpus: a citation that names one many times would otherwise read every record
 * for each.
 */
const heldDocumentsCache = new WeakMap<object, Map<string, Set<string>>>();

/** `needle` occurs in `hay` at a position not immediately followed by a digit. */
function occursNotBeforeDigit(hay: string, needle: string): boolean {
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    const next = hay.charAt(at + needle.length);
    if (next === "" || next < "0" || next > "9") return true;
  }
  return false;
}

export function heldInstrumentDocuments(regulations: Regulation[], instrument: string): Set<string> {
  const byInstrument = heldDocumentsCache.get(regulations) ?? new Map<string, Set<string>>();
  heldDocumentsCache.set(regulations, byInstrument);
  const known = byInstrument.get(instrument);
  if (known !== undefined) return known;
  const needles = heldNeedles(instrument);
  const docs = new Set<string>();
  for (const r of regulations) {
    const hay = `${r.framework}${r.document_id}${idDocSegment(r.id)}`.toLowerCase().replace(/[^a-z0-9]/g, "");
    // A needle counts only where no digit follows it: the squashed ids run their numbers together, so a bare substring
    // test let "regulation201817" (Regulation 2018/17) find a document id'd for 2018/171 and answer a citation of one act
    // out of another, which is the confident wrong citation this resolver exists to prevent.
    if (needles.some((n) => occursNotBeforeDigit(hay, n))) docs.add(r.document_id);
  }
  byInstrument.set(instrument, docs);
  return docs;
}

/** Does any served record belong to the instrument this citation names? */
export const corpusHolds = (regulations: Regulation[], instrument: string): boolean =>
  heldInstrumentDocuments(regulations, instrument).size > 0;

/**
 * A FRESH copy of the act-number pattern, for consumers that want the same grammar (the dashboard's "ingest next"
 * scan). The shared instance stays private: it is global (`g`), so a caller's `.exec()`/`.test()` would move its
 * `lastIndex` and make the next `matchAll` here start part-way into the text, silently skipping an act.
 */
export const numberedActPattern = (): RegExp => new RegExp(NUMBERED_ACT.source, NUMBERED_ACT.flags);
