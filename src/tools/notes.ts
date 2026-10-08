/**
 * Notes: the one place a response says something the reader must not lose.
 *
 * Everything the 0.x server said in `as_of_note`, `pending_changes_note`, `pre_adoption_placeholders` + `notice`,
 * `coverage_note` and the weak-match sentence is one list here, written to be repeated to the person the model is
 * answering. A note has a type (so a client can route it), a text (in the library's own words: no tool name, no field
 * name, none of the terms in src/language.ts) and, where it concerns particular provisions, the citations it applies to.
 *
 * The list is ABSENT when there is nothing to say, never empty: an empty list would read as "nothing to flag" and the
 * server cannot promise that, because "no amendment recorded" is not "none is coming".
 */
import { adapters } from "../adapters.ts";
import { citationOf, sourceFor } from "../citation-style.ts";
import { placeholderNotice, preAdoptionPlaceholders } from "../placeholders.ts";
import type { Regulation, Source } from "../schema.ts";
import { pendingNoteFor } from "./pending.ts";
import { asOfNote } from "./shared.ts";

export { NOTE_TYPES, NoteSchema, notesShape, type Note, type NoteType } from "./note-types.ts";
import type { Note } from "./note-types.ts";

/** `body` with its notes first, so the caveat is read before the text it qualifies; unchanged when there are none. */
export function withNotes<T extends object>(body: T, notes: readonly Note[]): T | ({ notes: Note[] } & T) {
  return notes.length === 0 ? body : { notes: [...notes], ...body };
}

/** The official citation of a provision, through its source's citation style. */
export async function officialCitation(reg: Pick<Regulation, "citation" | "framework" | "document_id">, sources?: readonly Source[]): Promise<string> {
  const all = sources ?? (await adapters.source.list());
  return citationOf(reg, sourceFor(reg, all));
}

/**
 * The notes a served provision carries: the version note when `as_of` was answered from current text, the amendment note
 * when a recorded change names it (as of the date asked for), the placeholder note when its text names an instrument by a
 * pre-adoption number.
 */
export async function provisionNotes(record: Regulation, opts: { asOf?: string | undefined; versionNote?: string | undefined } = {}): Promise<Note[]> {
  const sources = await adapters.source.list();
  const cite = citationOf(record, sourceFor(record, sources));
  const notes: Note[] = [];
  if (opts.versionNote !== undefined) notes.push({ type: "version", text: opts.versionNote, applies_to: [cite] });
  const amendment = await pendingNoteFor(record, opts.asOf);
  if (amendment !== undefined) notes.push({ type: "amendment", text: amendment, applies_to: [cite] });
  const found = preAdoptionPlaceholders(record.text);
  if (found !== null) {
    // The spans are quoted: a reader needs to know WHICH reference is unresolved, and a quotation is the author's words.
    const named = found.spans.map((x) => `“${x}”`).join("; ");
    notes.push({ type: "placeholder", text: `${placeholderNotice(found)} The placeholder${found.spans.length > 1 ? "s are" : " is"}: ${named}.`, applies_to: [cite] });
  }
  return notes;
}

export { asOfNote };

/** One note per distinct text: a batch of provisions that share a caveat says it once, with every citation it applies to. */
export function mergeNotes(notes: readonly Note[]): Note[] {
  const byText = new Map<string, Note>();
  for (const n of notes) {
    const key = `${n.type}\u0000${n.text}`;
    const seen = byText.get(key);
    if (seen === undefined) byText.set(key, { ...n, ...(n.applies_to === undefined ? {} : { applies_to: [...n.applies_to] }) });
    else if (n.applies_to !== undefined) seen.applies_to = [...new Set([...(seen.applies_to ?? []), ...n.applies_to])];
  }
  return [...byText.values()];
}
