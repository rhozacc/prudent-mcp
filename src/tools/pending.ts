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
import {
  isoDay,
  openPendingFor,
  pendingChangesNote,
  pendingSearchNotice,
  type OpenPendingChange,
} from "../pending.ts";
import type { Source } from "../schema.ts";

type Doc = { framework: string; document_id: string };

/**
 * The note for the document a record belongs to, as of `asOf` when one was asked
 * for. Undefined when nothing is open for it - and nothing is said, rather than
 * a reassurance: "no pending change recorded" is not "none is coming".
 */
export async function pendingNoteFor(doc: Doc, asOf?: string, now: Date = new Date()): Promise<string | undefined> {
  const today = isoDay(now);
  const sources = await adapters.source.list();
  return pendingChangesNote(openPendingFor(doc, sources, today, asOf), today);
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
 */
export async function pendingPageNotice(
  records: ({ id: string } & Doc)[],
  now: Date = new Date(),
): Promise<(pageRows: object[]) => string | undefined> {
  const today = isoDay(now);
  const sources: Source[] = await adapters.source.list();
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
    for (const row of pageRows) {
      const id = (row as { id?: unknown }).id;
      const rec = typeof id === "string" ? byId.get(id) : undefined;
      if (rec === undefined) continue;
      const key = `${rec.framework}\u0000${rec.document_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const o = openOf(rec);
      const first = o[0];
      if (first !== undefined) docs.push({ title: first.source.title, open: o });
    }
    return pendingSearchNotice(docs);
  };
}
