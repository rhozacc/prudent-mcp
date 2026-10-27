// Document aliases: the names a citation can scope itself to a document by.
import { heldInstrumentDocuments, instrumentSpans } from "./instruments.ts";
import { unexplainedWords } from "./names.ts";
import { STRUCTURAL, citationTokens, windowAt } from "./tokens.ts";
import type { Regulation, DocumentHolding } from "../schema.ts";
import { idDocSegment } from "../holdings.ts";

/** A name for one or more documents, as the words a caller would write it. */
interface AliasEntry {
  tokens: string[];
  docs: Set<string>;
  /**
   * Given by the registry (a title) or by the instrument the citation names (the
   * "Capital Requirements Regulation", "Regulation (EU) No 575/2013"), not one of
   * the ids the records carry. It scopes a citation only when the whole citation
   * is accounted for (`accountedFor`).
   */
  derived?: boolean;
}

export type AliasIndex = Map<string, AliasEntry>;

/**
 * Document aliases mapped to the documents they name.
 *
 * A citation identifies its document in whatever spelling the writer knows:
 * the framework ("eba"), the document id ("eba-gl-2017-16"), or the corpus's
 * own short id segment ("gl-2017-16", "egim"). All three are indexed, and an
 * alias naming several documents (a bare framework) narrows the pool to those
 * several rather than picking one.
 *
 * With the registry's holdings, a document's TITLE is a name too: "Article 12 of
 * Guidelines on the application of the definition of default" names a document by
 * what it is called, and without it that document was not named at all, so the
 * bare article number was answered from whichever document had one.
 */
export function documentAliases(regulations: Regulation[], holdings?: DocumentHolding[]): AliasIndex {
  const index: AliasIndex = new Map();
  const add = (raw: string, docId: string, derived = false): void => {
    const tokens = citationTokens(raw);
    if (tokens.length === 0) return;
    const key = tokens.join(" ");
    const slot = index.get(key);
    // An id keeps its entry as the ids made it: a derived name never loosens one.
    if (slot === undefined) index.set(key, { tokens, docs: new Set([docId]), ...(derived ? { derived } : {}) });
    else if (derived !== true || slot.derived === true) slot.docs.add(docId);
  };
  for (const r of regulations) {
    add(r.framework, r.document_id);
    add(r.document_id, r.document_id);
    add(idDocSegment(r.id), r.document_id);
    add(`${r.framework} ${r.document_id}`, r.document_id);
  }
  for (const h of holdings ?? []) {
    if (h.title === undefined) continue;
    for (const variant of titleNames(h.title)) add(variant, h.document_id, true);
  }
  return index;
}

/**
 * The words a registry title can be quoted by: the whole title, without its
 * parentheticals, the part before a subtitle, a dash or the clause that names its
 * legal basis ("... on the application of X under Article 178 of Regulation ..."),
 * which is how a guideline is usually called, and a parenthetical that is itself a
 * name ("... ('Downturn LGD estimation')"). Exact windows like every other name,
 * never a fuzzy match, and a variant must carry at least three words that are
 * neither structure nor a bare number, so "Guidelines", "(CRR)" or "Regulation
 * (EU) No 1" can never scope a citation on their own.
 */
function titleNames(title: string): string[] {
  const unbracketed = (t: string): string => t.replace(/\([^)]*\)/g, " ");
  const head =
    title.split(/\s[\u2014\u2013-]\s|:\s|\s(?:under|pursuant\s+to|in\s+accordance\s+with)\s+Articles?\b/i)[0] ?? title;
  const named = [...title.matchAll(/\(([^)]*)\)/g)].map((m) => (m[1] ?? "").replace(/["'\u2018\u2019\u201c\u201d]/g, " "));
  const variants = [title, unbracketed(title), head, unbracketed(head), ...named];
  const words = (t: string): number => citationTokens(t).filter((w) => !STRUCTURAL.has(w) && !/^\d+$/.test(w)).length;
  return [...new Set(variants.map((v) => v.replace(/\s+/g, " ").trim()))].filter((v) => words(v) >= 3);
}

/**
 * The document(s) a citation names, and the tokens that named them.
 *
 * The window is reported so it can be REMOVED before the spine is taken:
 * "EBA GL 2017/16 paragraph 78" carries the numbers 2017 and 16, which belong
 * to the document's name and not to the provision. Left in, they make the
 * spine ["2017","16","78"], which matches nothing — the resolver then falls
 * through to a looser rule, and looser rules are what fabricate.
 *
 * The same document named a second time in another form - its id beside its
 * title, "CRR" beside its number - leaves the citation too. Otherwise the second
 * name's words and numbers ("2016", "07") are read as the provision's. Only a name
 * that denotes nothing but the documents already chosen goes: a bare framework
 * that also names other documents stays, as it always did.
 */
export function scopeToDocument(
  tokens: string[],
  index: AliasIndex,
): { docs: Set<string> | null; rest: string[]; derived: boolean } {
  let best: AliasEntry | null = null;
  let bestAt = -1;
  for (const entry of index.values()) {
    const at = windowAt(tokens, entry.tokens);
    if (at === -1) continue;
    // Longest alias wins; among equals, the one naming fewest documents, and then
    // the first indexed (the ids, which come before any derived name).
    const better =
      best === null ||
      entry.tokens.length > best.tokens.length ||
      (entry.tokens.length === best.tokens.length && entry.docs.size < best.docs.size);
    if (better) {
      best = entry;
      bestAt = at;
    }
  }
  if (best === null) return { docs: null, rest: tokens, derived: false };
  let rest = [...tokens.slice(0, bestAt), ...tokens.slice(bestAt + best.tokens.length)];
  for (const other of index.values()) {
    if (other === best || [...other.docs].some((d) => !best.docs.has(d))) continue;
    for (let at = windowAt(rest, other.tokens); at !== -1; at = windowAt(rest, other.tokens)) {
      rest = [...rest.slice(0, at), ...rest.slice(at + other.tokens.length)];
    }
  }
  return { docs: best.docs, rest, derived: best.derived === true };
}

/**
 * Names for the held instruments a citation mentions.
 *
 * "Article 153 of the Capital Requirements Regulation" and "Article 160 of
 * Regulation (EU) No 575/2013" name a document the corpus holds, but not by any of
 * the words its ids carry. Unrecognised, the instrument was dropped, its number was
 * read as points of the provision, and the bare article number was answered from
 * whichever document had one - for the first, a paragraph of an unrelated guideline.
 * Each mention is added to the index as a name for the documents that carry the
 * instrument, so the ordinary rule applies: the longest name wins, its words leave
 * the citation, and the provision is looked for in those documents only. Added per
 * call, from the text, so nothing is invented that the caller did not write; an
 * instrument no held document carries is the gate's business.
 */
export function withInstrumentNames(index: AliasIndex, regulations: Regulation[], text: string): AliasIndex {
  const spans = instrumentSpans(text);
  if (spans.length === 0) return index;
  const named: AliasIndex = new Map(index);
  for (const { key, span } of spans) {
    const docs = heldInstrumentDocuments(regulations, key);
    const tokens = citationTokens(span);
    if (docs.size === 0 || tokens.length === 0) continue;
    const id = tokens.join(" ");
    const slot = named.get(id);
    // A name the ids already give ("crr") stays as the ids made it.
    if (slot === undefined) named.set(id, { tokens, docs, derived: true });
    else if (slot.derived === true) named.set(id, { ...slot, docs: new Set([...slot.docs, ...docs]) });
  }
  return named;
}

/**
 * May a name the registry or the instrument supplied scope this citation?
 *
 * Only when nothing else in it could be naming a different document. A name the
 * ids carry ("crr", "egim") scopes whatever else the citation says, as it always
 * did; a title or an instrument's number is longer and more exact, and so it WINS
 * over the ids, which makes it the one that can be wrong. "Paragraph 181 of EBA
 * guidelines on the identification of the group of connected clients referred to
 * in Regulation (EU) No 575/2013" names the regulation in a clause that only says
 * what the guidelines are issued under; scoped to the regulation, the bare 181
 * would be answered from the wrong body of law. So the scope is taken only when,
 * once the names of the chosen document(s) - and of a framework that contains
 * them - are removed, what is left is structure, filler and numbers: no word that
 * could name another document, and no other instrument still named (its number
 * would read as points). Otherwise the citation is resolved exactly as it was
 * before the derived names existed. An instrument named only as context for a held
 * one (`isContext`) is not a second claim and does not stop the scope.
 */
export function accountedFor(
  text: string,
  rest: string[],
  chosen: Set<string>,
  index: AliasIndex,
  isContext: (n: { key: string; start: number }) => boolean,
): boolean {
  for (const n of instrumentSpans(text)) {
    if (!isContext(n) && windowAt(rest, citationTokens(n.span)) !== -1) return false;
  }
  let remaining = rest;
  for (const entry of index.values()) {
    if (![...chosen].every((d) => entry.docs.has(d))) continue;
    for (let at = windowAt(remaining, entry.tokens); at !== -1; at = windowAt(remaining, entry.tokens)) {
      remaining = [...remaining.slice(0, at), ...remaining.slice(at + entry.tokens.length)];
    }
  }
  return unexplainedWords(remaining).length === 0;
}
