/**
 * Notes: the one place a response says something the reader must not lose.
 *
 * Everything the 0.x server said in five separate fields and sentences (see the migration table in docs/tools/index.md)
 * is one list here, written to be repeated to the person the model is
 * answering. A note has a type (so a client can route it), a text (in the library's own words: no tool name, no field
 * name, none of the terms in src/language.ts) and, where it concerns particular provisions, the citations it applies to.
 *
 * The list is ABSENT when there is nothing to say, never empty: an empty list would read as "nothing to flag" and the
 * server cannot promise that, because "no amendment recorded" is not "none is coming".
 */
import { adapters } from "../adapters.ts";
import { applicabilityText, replacedByIds, type ApplicabilitySubject } from "../applicability.ts";
import { citationOf, sourceFor } from "../citation-style.ts";
import { quoted } from "../language.ts";
import { isoDay } from "../pending.ts";
import { placeholderNotice, preAdoptionPlaceholders } from "../placeholders.ts";
import type { Applicability, Regulation, Source } from "../schema.ts";
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

// --- Applicability ---------------------------------------------------------------

/** Most rows named in the text of a search page's applicability note; `applies_to` carries every one. */
const MAX_NAMED = 3;

/** Citations of the provisions a declaration names as replacements; ids the library does not hold are left out, never printed. */
async function replacementCitations(a: Applicability, sources: readonly Source[]): Promise<string[]> {
  const found = await Promise.all(replacedByIds(a).map((id) => adapters.regulation.get(id)));
  return found.flatMap((r) => (r === null ? [] : [citationOf(r, sourceFor(r, sources))]));
}

/**
 * The note for one record that declares it does not apply, or does not apply yet. `label` is how the record is named in
 * `applies_to`: a provision's official citation, a check's or test's name, a playbook's title. Undefined when the record
 * declares nothing (absent is not "applies": there is no note and no reassurance).
 */
export async function applicabilityNote(
  a: Applicability | undefined,
  subject: ApplicabilitySubject,
  label: string,
  opts: { asOf?: string | undefined; sources?: readonly Source[] | undefined; now?: Date } = {},
): Promise<Note | undefined> {
  if (a === undefined) return undefined;
  const sources = opts.sources ?? (await adapters.source.list());
  const text = applicabilityText(a, subject, { today: isoDay(opts.now ?? new Date()), asOf: opts.asOf, replacedBy: await replacementCitations(a, sources), label });
  return { type: a.status, text, applies_to: [label] };
}

/**
 * The applicability notes for entries named by id (a provision, check, test or playbook), looked up as the library
 * holds them now. Ids it does not hold, and entries that declare nothing, give no note. One note per distinct text.
 */
export async function applicabilityNotesFor(ids: readonly string[], opts: { asOf?: string | undefined } = {}): Promise<Note[]> {
  const sources = await adapters.source.list();
  const notes: Note[] = [];
  for (const id of new Set(ids)) {
    let note: Note | undefined;
    if (id.startsWith("regulation://")) {
      const r = await adapters.regulation.get(id as never);
      if (r !== null) note = await applicabilityNote(r.applicability, "provision", citationOf(r, sourceFor(r, sources)), { ...opts, sources });
    } else if (id.startsWith("check://")) {
      const c = await adapters.check.get(id as never);
      if (c !== null) note = await applicabilityNote(c.applicability, "check", c.name, { ...opts, sources });
    } else if (id.startsWith("test://")) {
      const t = await adapters.test.get(id as never);
      if (t !== null) note = await applicabilityNote(t.applicability, "test", t.name, { ...opts, sources });
    } else if (id.startsWith("playbook://")) {
      const p = await adapters.playbook.get(id as never);
      if (p !== null) note = await applicabilityNote(p.applicability, "playbook", p.title, { ...opts, sources });
    }
    if (note !== undefined) notes.push(note);
  }
  return mergeNotes(notes);
}

/**
 * The note for the rows of a search page that declare they do not apply, or do not apply yet: ONE note per kind per page,
 * naming the affected rows by their label (their citation, name or title), like the page notice for a pending change.
 * Read once before the page is built, and applied to the rows that actually ended up on the page: a row cut by the size
 * ceiling is not named. Each row gives its date, so the note stands alone.
 */
export function applicabilityPageNotice<T extends { id: string; applicability?: Applicability | undefined }>(
  records: readonly T[],
  labelOf: (r: T) => string,
  now: Date = new Date(),
): (pageRows: object[]) => Note[] {
  const byId = new Map(records.filter((r) => r.applicability !== undefined).map((r) => [r.id, r] as const));
  const today = isoDay(now);
  return (pageRows) => {
    const items: Record<"historical" | "upcoming", { label: string; said: string }[]> = { historical: [], upcoming: [] };
    const seen = new Set<string>();
    for (const row of pageRows) {
      const id = (row as { id?: unknown }).id;
      const r = typeof id === "string" ? byId.get(id) : undefined;
      if (r === undefined || r.applicability === undefined || seen.has(r.id)) continue;
      seen.add(r.id);
      const a = r.applicability;
      const when =
        a.status === "historical"
          ? `${a.until < today ? "ceased" : "ceases"} to apply after ${a.until}`
          : a.from === undefined
            ? "date of application not yet fixed"
            : a.from > today
              ? `applies from ${a.from}`
              : `recorded as applying from ${a.from}`;
      items[a.status].push({ label: labelOf(r), said: `${quoted(labelOf(r))} (${when})` });
    }
    const notes: Note[] = [];
    const say = (kind: "historical" | "upcoming", one: string, many: string, tail: string): void => {
      const rows = items[kind];
      if (rows.length === 0) return;
      const shown = rows.slice(0, MAX_NAMED).map((x) => x.said).join("; ");
      const rest = rows.length - MAX_NAMED;
      notes.push({ type: kind, text: `${rows.length === 1 ? one : many}: ${shown}${rest > 0 ? `; and ${rest} more` : ""}. ${tail}`, applies_to: rows.map((x) => x.label) });
    };
    say("historical", "One result is text that no longer applies", "Some results are text that no longer applies", "Do not present it as the law now in force; open it for the reason and what replaced it.");
    say("upcoming", "One result is text that is not yet in application", "Some results are text that is not yet in application", "Do not present it as the law now in force; open it for the reason and the date.");
    return notes;
  };
}

/**
 * The notes a served provision carries: the applicability note when it no longer applies or does not apply yet, the
 * version note when `as_of` was answered from current text, the amendment note
 * when a recorded change names it (as of the date asked for), the placeholder note when its text names an instrument by a
 * pre-adoption number.
 */
export async function provisionNotes(
  record: Regulation,
  opts: {
    asOf?: string | undefined;
    versionNote?: string | undefined;
    /** False when this library holds no version of the provision for `asOf`: the applicability note then claims nothing about that date. */
    existed?: boolean | undefined;
  } = {},
): Promise<Note[]> {
  const sources = await adapters.source.list();
  const cite = citationOf(record, sourceFor(record, sources));
  const notes: Note[] = [];
  // The declaration that counts is the library's latest: a past version served under `as_of` carries none of its own.
  const latest = opts.asOf === undefined ? record : ((await adapters.regulation.get(record.id)) ?? record);
  const applies = await applicabilityNote(latest.applicability ?? record.applicability, "provision", cite, { asOf: opts.existed === false ? undefined : opts.asOf, sources });
  if (applies !== undefined) notes.push(applies);
  if (opts.versionNote !== undefined) notes.push({ type: "version", text: opts.versionNote, applies_to: [cite] });
  const amendment = await pendingNoteFor(record, opts.asOf);
  if (amendment !== undefined) notes.push({ type: "amendment", text: amendment, applies_to: [cite] });
  const found = preAdoptionPlaceholders(record.text);
  if (found !== null) {
    // The spans are quoted: a reader needs to know WHICH reference is unresolved, and a quotation is the author's words.
    const named = found.spans.map(quoted).join("; ");
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
