/**
 * The ONE definition of which provisions an amendment touches, and of what a
 * provision says about being amended.
 *
 * `pending_changes` is a statement about a DOCUMENT: an amendment applies, or
 * will, and the text this library holds does not yet include it. Put on every
 * record of the document, that is true of the document and false of most of its
 * provisions — an amendment to a handful of paragraphs said, on every other
 * paragraph, that the text might be out of date, and a model repeated it as
 * though it bore on the question. The warning that is always present is not read.
 *
 * So a provision is told only when it is named. Two things can name it:
 *
 * - `amends` on a provision of the AMENDING instrument ("this provision replaces
 *   that one from that date"). It carries the date, what kind of change it is,
 *   and the new wording, which is the amending provision's own text. The server
 *   never parses that text: the target was authored by whoever built the library
 *   and the linter checks it resolves, to another document.
 * - `affects_ids` on a pending change of the amended document, for a change whose
 *   provisions are known but whose amending provisions are not held.
 *
 * A document with open changes and NEITHER is "unmapped": nothing is said on its
 * provisions, and the change is stated once, at document level, where a caller
 * asks about sources (`get_source`, `get_corpus_info`) and in a search page's
 * notice. That is a deliberate loss — a provision of an unmapped document reads
 * as current — and it is the lesser one: the alternative is a note nobody reads
 * on provisions it does not concern.
 *
 * Whether an amendment is still OPEN comes from the amended document's pending
 * changes: while any is not ingested, the text served is the version before the
 * amendments. When all are ingested the text already carries them and nothing is
 * said. The date arithmetic is `pendingState`'s, with today a parameter.
 *
 * Pure over the supplied arrays: no I/O, no adapter handles.
 */
import {
  MAX_PENDING_NAMED,
  openPendingFor,
  sentenceFor,
  whenPhrase,
  type OpenPendingChange,
  type OpenPendingState,
} from "./pending.ts";
import type { AmendmentOp, Regulation, RegulationId, Source } from "./schema.ts";

/** One amending provision's claim on one target. */
export interface AmendmentEntry {
  target: RegulationId;
  op: AmendmentOp;
  effective_from: string;
  /** The point of the target the change is confined to, as the amending text names it; absent = the whole provision. */
  point?: string;
  /** The provision of the amending instrument that makes the change. */
  by: Regulation;
}

/** An amendment as it stands for the provision it targets, on a given day. */
export interface OpenAmendment extends AmendmentEntry {
  state: Exclude<OpenPendingState, "undated">;
}

export interface AmendmentIndex {
  byTarget: Map<string, AmendmentEntry[]>;
  /** The documents some amendment targets, by `framework` + `document_id`. */
  targetedDocuments: Set<string>;
}

const docKey = (d: { framework: string; document_id: string }): string => `${d.framework}\u0000${d.document_id}`;

// One index per record list, for as long as the list lives: the adapters hand in
// the same array on every call, and the scan is over every record.
const INDEXES = new WeakMap<object, { n: number; index: AmendmentIndex }>();

/** target id → the amendments aimed at it, across the whole library. */
export function amendmentIndex(regulations: Regulation[]): AmendmentIndex {
  const cached = INDEXES.get(regulations);
  if (cached !== undefined && cached.n === regulations.length) return cached.index;

  const byId = new Map(regulations.map((r) => [r.id as string, r]));
  const byTarget = new Map<string, AmendmentEntry[]>();
  const targetedDocuments = new Set<string>();
  for (const by of regulations) {
    for (const a of by.amends ?? []) {
      const target = byId.get(a.target);
      if (target === undefined) continue; // dangling: the linter's business, nothing to say here
      const list = byTarget.get(a.target) ?? [];
      list.push({ target: a.target, op: a.op, effective_from: a.effective_from, ...(a.point === undefined ? {} : { point: a.point }), by });
      byTarget.set(a.target, list);
      targetedDocuments.add(docKey(target));
    }
  }
  const index = { byTarget, targetedDocuments };
  INDEXES.set(regulations, { n: regulations.length, index });
  return index;
}

/**
 * Has anything said which of this document's provisions its open changes touch?
 * An open change with no `affects_ids`, in a document no amendment targets, has
 * not: it is stated at document level only.
 */
export function isMapped(
  doc: { framework: string; document_id: string },
  open: OpenPendingChange[],
  index: AmendmentIndex,
): boolean {
  return index.targetedDocuments.has(docKey(doc)) || open.some((o) => (o.change.affects_ids ?? []).length > 0);
}

/** The amendments aimed at `id` that apply on `asOf` (or at all, without a date), most urgent first. */
function amendmentsAimedAt(index: AmendmentIndex, id: string, today: string, asOf?: string): OpenAmendment[] {
  return (index.byTarget.get(id) ?? [])
    .filter((e) => asOf === undefined || asOf >= e.effective_from)
    .map((e): OpenAmendment => ({ ...e, state: e.effective_from > today ? "upcoming" : "in_force_not_ingested" }))
    .sort(
      (a, b) =>
        Number(a.state === "upcoming") - Number(b.state === "upcoming") || a.effective_from.localeCompare(b.effective_from),
    );
}

/** The open changes of the target's document that name it by id. */
function changesNaming(id: string, open: OpenPendingChange[]): OpenPendingChange[] {
  return open.filter((o) => (o.change.affects_ids ?? []).includes(id as RegulationId));
}

/**
 * Is `record` named by an open amendment or change? Only meaningful for a mapped
 * document; the page notice asks it of each row.
 */
export function isTargeted(
  record: { id: string; framework: string; document_id: string },
  regulations: Regulation[],
  sources: Source[],
  today: string,
  asOf?: string,
): boolean {
  const open = openPendingFor(record, sources, today, asOf);
  if (open.length === 0) return false;
  return (
    amendmentsAimedAt(amendmentIndex(regulations), record.id, today, asOf).length > 0 ||
    changesNaming(record.id, open).length > 0
  );
}

// --- Words ---------------------------------------------------------------------

/** How much of the new wording one note quotes; the amending provision has the rest. */
export const MAX_WORDING_CHARS = 480;

/** The amending instrument, as a reader knows it: its source's title, else its document id. */
function instrumentName(by: Regulation, sources: Source[]): string {
  const matching = sources.filter((s) => s.framework === by.framework && s.document_id === by.document_id);
  return (matching.find((s) => s.status === "current") ?? matching[0])?.title ?? by.document_id;
}

/** The amending provision's own text, whitespace collapsed and cut at a word. Quoted as a quotation. */
function wording(by: Regulation): string {
  const flat = by.text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_WORDING_CHARS) return `“${flat}”`;
  const cut = flat.slice(0, MAX_WORDING_CHARS);
  return `“${cut.slice(0, Math.max(cut.lastIndexOf(" "), MAX_WORDING_CHARS - 40))}…”`;
}

/** What one amendment says about the provision it targets. */
function sentenceForAmendment(a: OpenAmendment, sources: Source[], today: string): string {
  const who = `${instrumentName(a.by, sources)} (${a.by.citation})`;
  const upcoming = a.state === "upcoming";
  const when = upcoming ? `from ${a.effective_from}${whenPhrase(today, a.effective_from)}` : `since ${a.effective_from}`;
  const behind = upcoming ? "the text below is the version before it" : "the text below may no longer be the text in force";
  // An amendment confined to one point says so: "deletes point (a) of this provision" is not "deletes this provision".
  const what = a.point === undefined ? "this provision" : `point ${a.point} of this provision`;
  switch (a.op) {
    case "replace":
      return `${who} ${upcoming ? "replaces" : "has replaced"} ${what} ${when}; ${behind}. New wording: ${wording(a.by)}.`;
    case "delete":
      return `${who} ${upcoming ? "deletes" : "has deleted"} ${what} ${when}; ${behind}. ${a.point === undefined ? "It is" : "That point is"} deleted, with no new wording.`;
    case "insert_after":
      return `${who} ${upcoming ? "inserts" : "has inserted"} a new provision after this one ${when}${upcoming ? "" : "; it is not in the text of this library"}. New provision: ${wording(a.by)}.`;
  }
}

/**
 * What a provision says about being amended, or undefined when it is not named.
 *
 * Undefined is the usual answer and the point: a provision nothing targets says
 * nothing, whatever else is pending for its document. Never a reassurance — "no
 * amendment recorded" is not "none is coming".
 *
 * Amendments aimed at the provision come first, with the new wording; a change
 * that names the provision by id (and has no amending provision held) is said in
 * the change's own words, narrowed to this provision. At most MAX_PENDING_NAMED
 * are spelled out and the rest counted.
 */
export function provisionPendingNote(
  record: { id: string; framework: string; document_id: string },
  regulations: Regulation[],
  sources: Source[],
  today: string,
  asOf?: string,
): string | undefined {
  // Is the text this library holds for the document still behind at all? That is the
  // registry's word, and does not depend on the date asked about.
  if (openPendingFor(record, sources, today).length === 0) return undefined;
  const index = amendmentIndex(regulations);

  // Which of them apply on that date is each one's own business: an amendment by its
  // own `effective_from`, a change that names the provision by id by the change's. A
  // provision nothing aims at and no change names has no sentence, which is what makes
  // its document "unmapped" for it: there is no separate test to make here.
  const aimed = amendmentsAimedAt(index, record.id, today, asOf);
  const sentences: Array<{ behind: boolean; text: string }> = aimed.map((a) => ({
    behind: a.state === "in_force_not_ingested",
    text: sentenceForAmendment(a, sources, today),
  }));
  if (aimed.length === 0) {
    for (const o of changesNaming(record.id, openPendingFor(record, sources, today, asOf))) {
      sentences.push({ behind: o.state === "in_force_not_ingested", text: sentenceFor(o, today) });
    }
  }
  if (sentences.length === 0) return undefined;

  const named = sentences.slice(0, MAX_PENDING_NAMED);
  const rest = sentences.length - named.length;
  const lead = named.some((s) => s.behind) ? "Text may be out of date: " : "Pending change to this provision: ";
  return lead + named.map((s) => s.text).join(" ") + (rest > 0 ? ` (${rest} more.)` : "");
}
