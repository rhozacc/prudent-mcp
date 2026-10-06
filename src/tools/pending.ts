/**
 * The tool-layer half of the pending-change signal: reading the registry through
 * the adapter and attaching the statement to a response. What a pending change IS,
 * and the words that describe one, are defined once in src/pending.ts.
 *
 * It reads `adapters.source.list()` rather than asking the meta adapter, so an
 * outside backend that serves sources gets the signal without a new method. A
 * backend with no sources serves none - an empty registry has nothing to say.
 */
import { adapters } from "../adapters.ts";
import { amendmentIndex, isMapped, isTargeted, provisionPendingNote } from "../amendments.ts";
import {
  MAX_PENDING_NAMED,
  isoDay,
  openPendingFor,
  pendingSearchNotice,
  type OpenPendingChange,
} from "../pending.ts";
import type { Regulation, Source } from "../schema.ts";

type Doc = { framework: string; document_id: string };
/** A provision, as the notes see it: which document it is of, and which provision it is. */
type Provision = Doc & { id: string };

/**
 * The note for a provision, as of `asOf` when one was asked for: what an
 * amendment aimed at it, or a change that names it, says about the text in front
 * of the caller (src/amendments.ts). Undefined when nothing names it - which is
 * the usual answer, and is not a reassurance: "no amendment recorded" is not
 * "none is coming". A document with open changes that nothing maps to provisions
 * is stated at document level (`get_source`, `get_corpus_info`, a search page's
 * notice) and not here.
 */
export async function pendingNoteFor(record: Provision, asOf?: string, now: Date = new Date()): Promise<string | undefined> {
  const [sources, regulations] = await Promise.all([adapters.source.list(), adapters.regulation.list()]);
  return provisionPendingNote(record, regulations, sources, isoDay(now), asOf);
}

/**
 * Attach `pending_changes_note` to a response body, ahead of the record fields so
 * the caveat is read before the text it qualifies. With no note the body is
 * returned untouched: the key is absent, never present and empty.
 */
export function withPendingNote<T extends Record<string, unknown>>(
  body: T,
  note: string | undefined,
): T | (T & { pending_changes_note: string }) {
  return note === undefined ? body : { pending_changes_note: note, ...body };
}

/**
 * A page notice for a set of records, from the documents they belong to. Read once
 * before the page is built (`sources` and `today` are fixed for the request), and
 * applied to the rows that actually ended up on the page.
 *
 * Two kinds of sentence, because two kinds of document: one whose changes nothing
 * maps to provisions is said once per document ("a document with a change its
 * text does not yet include"), and one whose changes are mapped is said only of
 * the rows that are named — a page of the OTHER provisions of that document gets
 * no sentence at all.
 */
export async function pendingPageNotice(
  records: (Provision & Pick<Regulation, "citation">)[],
  now: Date = new Date(),
): Promise<(pageRows: object[]) => string | undefined> {
  const today = isoDay(now);
  const [sources, regulations]: [Source[], Regulation[]] = await Promise.all([
    adapters.source.list(),
    adapters.regulation.list(),
  ]);
  const index = amendmentIndex(regulations);
  const byId = new Map(records.map((r) => [r.id, r]));
  const open = new Map<string, OpenPendingChange[]>();
  const openOf = (d: Doc): OpenPendingChange[] => {
    const key = `${d.framework}\u0000${d.document_id}`;
    let found = open.get(key);
    if (found === undefined) {
      found = openPendingFor(d, sources, today);
      open.set(key, found);
    }
    return found;
  };
  return (pageRows) => {
    const seen = new Set<string>();
    const docs: { title: string; open: OpenPendingChange[] }[] = [];
    const named: string[] = [];
    for (const row of pageRows) {
      const id = (row as { id?: unknown }).id;
      const rec = typeof id === "string" ? byId.get(id) : undefined;
      if (rec === undefined) continue;
      const o = openOf(rec);
      const first = o[0];
      if (first === undefined) continue;
      if (isMapped(rec, o, index)) {
        if (isTargeted(rec, regulations, sources, today)) named.push(rec.citation);
        continue;
      }
      const key = `${rec.framework}\u0000${rec.document_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push({ title: first.source.title, open: o });
    }
    const parts = [pendingSearchNotice(docs), namedNotice(named)].filter((p): p is string => p !== undefined);
    return parts.length === 0 ? undefined : parts.join(" ");
  };
}

/** The sentence for rows an open change names: their citations, not their document. */
function namedNotice(citations: string[]): string | undefined {
  if (citations.length === 0) return undefined;
  const shown = citations.slice(0, MAX_PENDING_NAMED).join("; ");
  const rest = citations.length - MAX_PENDING_NAMED;
  return (
    `${citations.length === 1 ? "One result is a provision" : "Some results are provisions"} that a recorded change affects: ` +
    `${shown}${rest > 0 ? `; and ${rest} more` : ""}. The text shown is the version before it.`
  );
}
