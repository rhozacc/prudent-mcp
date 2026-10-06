/**
 * The ONE definition of what a pending change to a document means, and of how a
 * served record talks about it.
 *
 * A corpus is a snapshot. The registry usually knows something the snapshot does
 * not: an amendment adopted and not yet applying, or one that has come into force
 * since the text was ingested. A model handed the snapshot's text reads it as the
 * law, and the two cases need opposite sentences - "this will change on D" and
 * "this has changed and the text you hold is behind". `Source.verified` and
 * `stale_sources` say when the registry last looked; neither says what it found.
 *
 * Everything derived is computed here, at serve time, from what the registry
 * stores (`ingested`, `effective_from`) and today's date. Nothing derived is
 * stored, so a note cannot go on saying "upcoming" the morning after the day.
 *
 * Pure over the supplied arrays: no I/O, no adapter handles. The date is a
 * parameter (as `staleSourceIds` takes `now`), so a state is testable without a
 * clock.
 */
import type {
  PendingChange,
  PendingChangeState,
  PendingChangeSummary,
  Source,
} from "./schema.ts";

/** The states worth saying anything about: `ingested` is the quiet one. */
export type OpenPendingState = Exclude<PendingChangeState, "ingested">;

/** One change that is not ingested, with the source it was declared on. */
export interface OpenPendingChange {
  source: Source;
  change: PendingChange;
  state: OpenPendingState;
}

/** ISO calendar day of a date, the form every date in the registry is compared in. */
export const isoDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Where one change stands on `today`.
 *
 * The day a change applies FROM is a day it applies: on `effective_from` itself
 * the change is in force, so the strict comparison is on the day before.
 */
export function pendingState(change: PendingChange, today: string): PendingChangeState {
  if (change.ingested) return "ingested";
  if (change.effective_from === undefined) return "undated";
  return change.effective_from > today ? "upcoming" : "in_force_not_ingested";
}

// Most urgent first: text that is already behind the law, then what is coming
// soonest, then what has no date.
const URGENCY: Record<OpenPendingState, number> = { in_force_not_ingested: 0, upcoming: 1, undated: 2 };

function byUrgency(a: OpenPendingChange, b: OpenPendingChange): number {
  const u = URGENCY[a.state] - URGENCY[b.state];
  if (u !== 0) return u;
  return (a.change.effective_from ?? "").localeCompare(b.change.effective_from ?? "");
}

/**
 * Every change that is not ingested, across the sources that speak for a
 * document. Only a CURRENT source speaks, as in `computeHoldings`: a superseded
 * or pending source describes another edition of the document, whose changes are
 * not changes to what is served.
 */
export function openPendingChanges(sources: Source[], today: string): OpenPendingChange[] {
  const out: OpenPendingChange[] = [];
  for (const source of sources) {
    if (source.status !== "current") continue;
    for (const change of source.pending_changes ?? []) {
      const state = pendingState(change, today);
      if (state !== "ingested") out.push({ source, change, state });
    }
  }
  return out.sort(byUrgency);
}

/**
 * Does any source say anything about pending changes? `pending_changes: []` is a
 * statement (looked, nothing pending) and a missing key is not, so the corpus-wide
 * list below is served only when somebody made one.
 */
export const declaresPendingChanges = (sources: Source[]): boolean =>
  sources.some((s) => s.pending_changes !== undefined);

/**
 * The open changes as `get_corpus_info` lists them, or undefined when no source
 * declares the field at all (absent is not empty: `[]` would say the registry
 * looked and found nothing).
 */
export function pendingChangeSummaries(sources: Source[], now: Date = new Date()): PendingChangeSummary[] | undefined {
  if (!declaresPendingChanges(sources)) return undefined;
  return openPendingChanges(sources, isoDay(now)).map(({ source, change, state }) => ({
    source: source.id,
    document_id: source.document_id,
    title: change.title,
    ...(change.reference === undefined ? {} : { reference: change.reference }),
    status: change.status,
    ...(change.effective_from === undefined ? {} : { effective_from: change.effective_from }),
    state,
  }));
}

/**
 * The open changes that bear on the text of ONE document, as of `asOf` when a
 * date was asked for.
 *
 * Joined to the document by `framework` + `document_id`, the only join the
 * registry has. Under a date, a change that had not yet applied then is left out:
 * the text served for a date before it is not behind it, whichever version of the
 * text that is. A change with no application date has no such bound and stays.
 */
export function openPendingFor(
  doc: { framework: string; document_id: string },
  sources: Source[],
  today: string,
  asOf?: string,
): OpenPendingChange[] {
  const mine = sources.filter((s) => s.framework === doc.framework && s.document_id === doc.document_id);
  return openPendingChanges(mine, today).filter(
    ({ change }) => asOf === undefined || change.effective_from === undefined || asOf >= change.effective_from,
  );
}

// --- Words ---------------------------------------------------------------------

/** The most changes spelled out in one note; the rest are counted. */
export const MAX_PENDING_NAMED = 3;
/** The most `affects` entries quoted for one change. */
const MAX_AFFECTS = 4;

/** Whole days from `today` to `date`, both ISO days. */
const daysBetween = (today: string, date: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** "in 17 days", "tomorrow"; nothing for a date far enough ahead that a count says little. */
export function whenPhrase(today: string, date: string): string {
  const n = daysBetween(today, date);
  if (n === 1) return " (tomorrow)";
  if (n > 1 && n <= 120) return ` (in ${n} days)`;
  return "";
}

const labelOf = (c: PendingChange): string =>
  c.reference !== undefined && !c.title.includes(c.reference) ? `${c.title} (${c.reference})` : c.title;

const affectsOf = (c: PendingChange): string =>
  c.affects === undefined || c.affects.length === 0
    ? ""
    : ` Said to concern ${c.affects.slice(0, MAX_AFFECTS).join("; ")}${c.affects.length > MAX_AFFECTS ? "; ..." : ""}.`;

/** What one open change says about the text being served. */
export function sentenceFor(o: OpenPendingChange, today: string): string {
  const { change: c, state } = o;
  const announced = c.status === "announced";
  const label = labelOf(c);
  const tail = affectsOf(c);
  if (state === "in_force_not_ingested") {
    const date = c.effective_from ?? "";
    return announced
      ? `${label} was expected to apply from ${date}; the text below may be out of date.${tail}`
      : `${label} has applied since ${date}; the text below may no longer be the text in force.${tail}`;
  }
  if (state === "upcoming") {
    const date = c.effective_from ?? "";
    return (
      `${label} ${announced ? "is expected to apply" : "applies"} from ${date}${whenPhrase(today, date)}; ` +
      `the text below is the version before it.${tail}`
    );
  }
  return `${label} is ${announced ? "announced" : "adopted"} with no application date recorded; the text below does not reflect it.${tail}`;
}

/**
 * The statement that goes with a record of a document that has open changes.
 *
 * It exists because the failure is invisible from inside the record: a text that
 * has been overtaken reads exactly like one that has not. It says which change,
 * when it applies, that this corpus does not carry it, and (from the registry)
 * which provisions it concerns - and nothing about what the change says, which
 * the corpus does not hold. Undefined when nothing is open: no note, never an
 * empty one.
 */
export function pendingChangesNote(open: OpenPendingChange[], today: string): string | undefined {
  if (open.length === 0) return undefined;
  const named = open.slice(0, MAX_PENDING_NAMED);
  const behind = named.some((o) => o.state === "in_force_not_ingested");
  const lead = behind ? "Text may be out of date: " : "Pending change to this document: ";
  const rest = open.length - named.length;
  return (
    lead +
    named.map((o) => sentenceFor(o, today)).join(" ") +
    (rest > 0 ? ` (${rest} more.)` : "")
  );
}

/**
 * The sentence a search page adds to `notice` when some rows come from documents
 * with open changes. One line per page, not per row: the note on each record is
 * one get_regulation away.
 */
export function pendingSearchNotice(docs: { title: string; open: OpenPendingChange[] }[]): string | undefined {
  const withOpen = docs.filter((d) => d.open.length > 0);
  if (withOpen.length === 0) return undefined;
  const items = withOpen.slice(0, MAX_PENDING_NAMED).map((d) => {
    const first = d.open[0];
    if (first === undefined) return d.title;
    const when =
      first.change.effective_from === undefined
        ? "no date recorded"
        : first.state === "in_force_not_ingested"
          ? `applied ${first.change.effective_from}`
          : `from ${first.change.effective_from}`;
    return `${d.title} (${labelOf(first.change)}, ${when}${d.open.length > 1 ? `, +${d.open.length - 1} more` : ""})`;
  });
  const rest = withOpen.length - items.length;
  return (
    "Some results come from a document with a change its text does not yet include: " +
    `${items.join("; ")}${rest > 0 ? `; and ${rest} more` : ""}. The text shown is the version before it.`
  );
}

/**
 * Advisory findings for the linter: a change that has come into force without
 * being ingested means the corpus serves text that is behind the law right now.
 * Never fatal - the registry may be ahead of the extraction by design - but it
 * should not be quiet.
 */
export function pendingChangeWarnings(sources: Source[], now: Date = new Date()): string[] {
  const today = isoDay(now);
  return openPendingChanges(sources, today)
    .filter((o) => o.state === "in_force_not_ingested")
    .map(
      (o) =>
        `${o.source.id}: ${labelOf(o.change)} has applied since ${o.change.effective_from} but is not ingested — ` +
        "the text this corpus serves for the document is out of date",
    );
}
