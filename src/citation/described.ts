// Instruments named by DESCRIPTION rather than by number: the one table and its readers.
import { ACT_TAG, numberedActs } from "./instruments.ts";
import type { NumberedAct } from "./instruments.ts";
import { CITATION_EXPANSIONS, citationTokens, windowAt } from "./tokens.ts";
import type { Regulation } from "../schema.ts";
import { idDocSegment } from "../holdings.ts";

/**
 * Words that make the instrument after them a mention rather than the home of the
 * provision: "Article 178 of the CRR, as amended by Regulation (EU) 2024/1623" is
 * about the CRR, not about the act that amends it. Only the phrases that say so on
 * their own. "under" and "of" are how a caller attaches a provision to its
 * instrument ("Article 14 under Regulation (EU) 2022/439"), so they are not here.
 */
export const SUBORDINATING_CUE =
  /\b(?:(?:as\s+)?(?:amended|supplemented|implemented|replaced|corrected|repealed)\s+by|referred\s+to\s+in|pursuant\s+to|in\s+accordance\s+with|(?:adopted|issued)\s+under|within\s+the\s+meaning\s+of|cited\s+in|mentioned\s+in|see\s+also)\s+(?:(?:the|a|an|commission|council|delegated|implementing)\s+)*$/i;

/**
 * Instruments a citation can name by DESCRIPTION rather than by number, and how
 * to recognise each in prose. The single table: `describedInstruments` reads it
 * to find what a citation names, `holdsKind` reads `held` to ask whether the
 * corpus has a document identifying as that kind.
 *
 * Every kind is recognised in every spelling a writer has for it, because the
 * gate is only as good as its weakest spelling: respell the kind and the
 * instrument is dropped, and the bare article number goes looking in whatever
 * held a provision with it. So the acronyms take any case, a plural and dots
 * ("rts", "RTSs", "R.T.S."), and the spelled-out forms take any run of white
 * space or dashes between their words. The one place case still matters is ITS,
 * because "its" is a pronoun in half the prose ever written: ITS matches in
 * upper case, and in any case straight after a determiner ("the its on
 * reporting"), where a pronoun cannot stand. A bare "technical standards" names
 * one of the two without saying which, so either kind releases it. A bare
 * "delegated"/"implementing" is not a description of an instrument; it has to be
 * followed by what the act is. And a descriptor that goes on to give the act's
 * NUMBER in the form the number gate reads ("Delegated Regulation (EU)
 * 2022/439") is not a description at all: that gate owns the citation, and
 * re-reading it here would flip one the corpus resolves today. A number the gate
 * CANNOT read ("Delegated Regulation 2022/439", no "(EU)") is still a
 * description, and is declined as one: it is the same unheld instrument, and
 * falling through is how a same-numbered provision of an unrelated document got
 * offered for it.
 *
 * `held` lists token windows; a corpus document "identifies as" the kind when
 * its framework, document id or id segment contains one as a contiguous run.
 * Tokens, never substrings - "its" is inside "limits", "rts" inside "reports" -
 * and the patterns below are anchored to whole words for the same reason.
 */
const KIND_GAP = String.raw`[\s\-‐-―]+`;

const kindWords = (...words: string[]): string => words.join(KIND_GAP);

const DESCRIBED_INSTRUMENTS: Array<{
  key: string;
  re: RegExp;
  held: string[][];
  /** Also an ordinary English word, so an all-capitals citation cannot be trusted to mean the acronym. */
  pronoun?: boolean;
  /** Who issues it, for kinds that name an issuer ("ECB Guideline"): lets a held document of the same issuer be told apart from the described one. */
  issuer?: string;
  /** The descriptor is the pattern's one capture group; the rest of the match is only what has to stand before it. */
  inGroup?: boolean;
}> = [
  { key: "rts", re: /\bR\.T\.S\b\.?|\bRTSs?\b/gi, held: [["rts"]] },
  {
    key: "rts",
    re: new RegExp(`\\b${kindWords("regulatory", "technical", "standards?")}\\b`, "gi"),
    held: [["rts"], ["regulatory", "technical", "standard"], ["regulatory", "technical", "standards"]],
  },
  { key: "its", re: /\bITSs?\b/g, held: [["its"]], pronoun: true },
  { key: "its", re: /\bI\.T\.S\b\.?/gi, held: [["its"]] },
  // "its" cannot be a pronoun straight after an article ("the its on reporting").
  // Not "that": "a rule that its text amends" is ordinary English. The article is
  // matched, not looked behind for: a look-behind over white space is tried at every
  // position of a run of it, which made a long run cost the square of its length.
  { key: "its", re: /\b(?:the|an?|this)\s+(its)\b/gi, held: [["its"]], inGroup: true },
  {
    key: "its",
    re: new RegExp(`\\b${kindWords("implementing", "technical", "standards?")}\\b`, "gi"),
    held: [["its"], ["implementing", "technical", "standard"], ["implementing", "technical", "standards"]],
  },
  {
    // Not when the word that makes it one of the two above stands before it: that phrase
    // is one of them, and `describedInstruments` leaves it out where it lies inside one.
    key: "technical-standards",
    re: new RegExp(`\\b${kindWords("technical", "standards?")}\\b`, "gi"),
    held: [["rts"], ["its"], ["technical", "standard"], ["technical", "standards"]],
  },
  {
    key: "delegated",
    re: new RegExp(`\\b(?:commission${KIND_GAP})?delegated${KIND_GAP}(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["delegated"]],
  },
  {
    key: "implementing",
    re: new RegExp(`\\b(?:commission${KIND_GAP})?implementing${KIND_GAP}(?:regulation|decision|act)s?\\b`, "gi"),
    held: [["implementing"]],
  },
  ...(["regulation", "guideline", "decision", "recommendation"] as const).map((kind) => ({
    key: `ecb-${kind}`,
    // The ECB, its dotted acronym or its full name, with or without a possessive.
    re: new RegExp(
      `(?:\\becb|\\bE\\.C\\.B\\b\\.?|\\beuropean${KIND_GAP}central${KIND_GAP}bank)(?:['’]s)?\\s+${kind}s?\\b`,
      "gi",
    ),
    held: [["ecb", kind], ["ecb", `${kind}s`], ["european", "central", "bank", kind], ["european", "central", "bank", `${kind}s`]],
    issuer: "ecb",
  })),
  {
    key: "ecb-guideline",
    re: new RegExp(
      `\\bguidelines?\\s+of\\s+the\\s+(?:ecb|european${KIND_GAP}central${KIND_GAP}bank)\\b`,
      "gi",
    ),
    held: [["ecb", "guideline"], ["ecb", "guidelines"]],
    issuer: "ecb",
  },
];

interface DescribedInstrument {
  /** The kind of the table entry that matched, so one kind named twice is quoted once. */
  key: string;
  /** The citation's own words for it, quoted back. */
  quote: string;
  held: string[][];
  /** Written as a numbered identifier ("RTS/2016/03"), not as a description. */
  identifier: boolean;
  /** A number follows the descriptor ("ITS 2021/451"), in a shape the number gate does not read. */
  numbered: boolean;
  /** The issuer the table entry names, if it names one. */
  issuer?: string;
}

/**
 * Where a descriptor's own words end. The kind and what it is on ("RTS on the IRB
 * assessment methodology") belong to it; the punctuation, dash, provision
 * reference or "under / referred to in" that starts something else does not.
 */
const DESCRIPTOR_END =
  /[,;:()[\]"\u201c\u201d]|\s[-\u2013\u2014]\s|\b(?:art(?:icle)?s?|para(?:graph)?s?|sections?|chapters?|annex(?:es)?|points?)\.?\s*\(?\d|\s(?:under|referred|cited|mentioned|pursuant|adopted|according|per|as)\b/i;

/** A full stop that ends the sentence rather than abbreviating a word. */
const SENTENCE_END = /\.(?=\s+[A-Z]|\s*$)/;

/** Where in `after` a held document's name begins (one of `names`, as whole tokens), or -1. */
function nameStartsAt(after: string, names: string[][]): number {
  if (names.length === 0) return -1;
  const words = [...after.matchAll(/[A-Za-z0-9]+/g)].map((m) => ({
    at: m.index,
    token: CITATION_EXPANSIONS[m[0].toLowerCase()] ?? m[0].toLowerCase(),
  }));
  for (let i = 0; i < words.length; i++) {
    if (names.some((n) => n.length > 0 && n.every((t, j) => words[i + j]?.token === t))) return words[i]?.at ?? -1;
  }
  return -1;
}

/**
 * The caller's own words for a described instrument, quoted back in a note: the
 * descriptor and what it is on, cut where something else starts. The whole rest
 * of the clause used to be quoted, which put the held document's id and the
 * provision itself inside "the description". A held document's name cuts it too:
 * "ECB Guideline egim para 3.181" describes "ECB Guideline", and names egim.
 */
function descriptorQuote(text: string, start: number, matched: string, names: string[][]): string {
  const after = text.slice(start + matched.length);
  const stops = [after.search(DESCRIPTOR_END), after.search(SENTENCE_END), nameStartsAt(after, names)].filter((n) => n !== -1);
  const own = `${matched}${stops.length === 0 ? after : after.slice(0, Math.min(...stops))}`;
  const body = own
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\s+(?:of|in|on|under|from|and|or|to|the|an?|as|by|at|for|with|see))+$/i, "")
    .replace(/[:;,\s]+$/, "");
  // A full stop closes a dotted acronym ("R.T.S.") and nothing else.
  const quote = /(?:\b[A-Za-z]\.){2,}$/.test(body) ? body : body.replace(/\.+$/, "");
  return quote.length === 0 || quote.length > 80 ? matched : quote;
}

/**
 * A number straight after a descriptor, as "ITS 2021/451" or "RTS (EU) No 2016/03"
 * give it, or the identifier an authority numbers it with ("ECB Guideline
 * ECB/2014/60"): either names one specific instrument, not a kind of text.
 */
const NUMBER_AFTER_DESCRIPTOR = new RegExp(
  String.raw`^\s*(?:\(${ACT_TAG}\)\s*)?(?:no\.?\s*)?\d{1,4}\s*\/\s*\d{1,4}\b` +
    String.raw`|^\s*(?:\(\s*)?[A-Za-z]{2,10}(?:\s*\/\s*[A-Za-z]{2,10})*\s*\/\s*(?:19|20)\d{2}\s*\/\s*\d{1,4}\b`,
  "i",
);

/**
 * Does the number gate read an act number starting at the kind word that ends this
 * match? It asks the gate's own reader (`numberedActs`), not the raw pattern: the
 * pattern also matches "Regulation 5/2", which is no act number, and a descriptor
 * waved through on the strength of it would be read by neither gate.
 */
function numberGateReads(acts: NumberedAct[], start: number, matched: string): boolean {
  // The kind word is the last run of letters of the match, whatever sat between its words.
  const kindAt = start + matched.search(/[A-Za-z]+$/);
  return acts.some((a) => a.start === kindAt);
}

/**
 * Instruments the citation names by description, and the citation with those
 * words removed (so the rest can be scoped to a held document without "ECB" in
 * "ECB Regulation" being read as the held ECB guide). The words are cut out by
 * POSITION, never by searching for their text: a descriptor spelled "rts" would
 * otherwise be found first inside "reports".
 */
export function describedInstruments(
  text: string,
  // The names of the documents the corpus holds, as token windows, so a quote can stop short of one.
  names: string[][] = [],
): { found: DescribedInstrument[]; residual: string } {
  // An all-capitals citation has lost the case that tells ITS from a shouted
  // pronoun. The other kinds have no pronoun reading, so they stay recognised.
  const caseLost = !/[a-z]/.test(text);
  const acts = numberedActs(text);
  const found: DescribedInstrument[] = [];
  const cut: Array<[number, number]> = [];
  // Every match of every kind, in the order the caller wrote them, so a kind named
  // twice is quoted at its first (and usually fuller) mention.
  const all = DESCRIBED_INSTRUMENTS.flatMap((entry) =>
    entry.pronoun === true && caseLost
      ? []
      : [...text.matchAll(entry.re)].map((m) => {
          // The descriptor's own words: the whole match, or the group an entry names.
          const matched = entry.inGroup === true ? (m[1] ?? "") : m[0];
          return { entry, start: m.index + m[0].length - matched.length, matched };
        }),
  );
  // "technical standards" is not a kind of its own where "regulatory" or "implementing"
  // stands before it: the longer phrase is the instrument, and it has already matched.
  const qualified = all.filter((h) => h.entry.key === "rts" || h.entry.key === "its");
  const hits = all
    .filter(
      (h) =>
        h.entry.key !== "technical-standards" ||
        !qualified.some((q) => q.start <= h.start && h.start + h.matched.length <= q.start + q.matched.length),
    )
    .sort((a, b) => a.start - b.start || b.matched.length - a.matched.length);
  for (const { entry: { key, held, issuer }, start, matched } of hits) {
    const end = start + matched.length;
    if (numberGateReads(acts, start, matched)) continue;
    // "EBA/RTS/2016/03" is an identifier. It names its instrument by number, in
    // a shape the number gate does not read, so it is declined for what it is.
    const id = /^\s*\/\s*(\d{4})\s*\/\s*(\d{1,4})\b/.exec(text.slice(end));
    if (id !== null) {
      const lead = /(?:\b[A-Za-z]+\s*\/\s*)*$/.exec(text.slice(0, start))?.[0] ?? "";
      const whole = `${lead}${matched}${id[0]}`.replace(/\s+/g, "");
      if (!found.some((f) => f.quote === whole)) {
        found.push({
          key,
          quote: whole,
          held: [citationTokens(`${matched} ${id[1] ?? ""} ${id[2] ?? ""}`)],
          identifier: true,
          numbered: true,
        });
      }
      cut.push([start - lead.length, end + id[0].length]);
      continue;
    }
    // The same kind named twice in one phrase ("regulatory technical standards
    // (RTS) on ...") is one instrument, quoted once - and not worked out again: the
    // quote reads the rest of the text, so doing it for every mention of a kind made
    // a text that names one many times cost the square of its length.
    if (found.some((f) => f.key === key && !f.identifier)) {
      cut.push([start, end]);
      continue;
    }
    const quote = descriptorQuote(text, start, matched, names);
    if (!found.some((f) => f.quote === quote)) {
      const numbered = NUMBER_AFTER_DESCRIPTOR.test(text.slice(end));
      found.push({ key, quote, held, identifier: false, numbered, ...(issuer === undefined ? {} : { issuer }) });
    }
    cut.push([start, end]);
  }
  // Blank the cut spans, merged so none is cut twice, from the end backwards so
  // earlier offsets stay valid.
  const merged: Array<[number, number]> = [];
  for (const [from, to] of cut.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged[merged.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  let residual = text;
  for (const [from, to] of merged.reverse()) residual = `${residual.slice(0, from)} ${residual.slice(to)}`;
  return { found, residual };
}

/**
 * Does any document identify as this kind? A document does when its framework,
 * its document id, its id segment or "framework document_id" carries one of the
 * windows as a contiguous run of tokens. Exported because the eval that checks the
 * gate must decide "held" exactly as the gate does, or it reports a fatal defect
 * on a corpus the resolver handles correctly.
 */
export function holdsKind(
  regulations: Array<Pick<Regulation, "id" | "framework" | "document_id">>,
  held: string[][],
): boolean {
  return regulations.some((r) =>
    [r.framework, r.document_id, idDocSegment(r.id), `${r.framework} ${r.document_id}`].some((field) => {
      const tokens = citationTokens(field);
      return held.some((window) => windowAt(tokens, window) !== -1);
    }),
  );
}

/** The kinds a citation names by description, read from the one table. For the eval. */
export const describedKindWindows = (text: string): string[][] =>
  describedInstruments(text).found.flatMap((f) => f.held);
