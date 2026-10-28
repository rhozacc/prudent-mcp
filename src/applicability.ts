/**
 * The ONE definition of what a declaration of applicability says, and of the words that say it.
 *
 * A corpus may declare that text no longer applies (`historical`, with the last day it applied) or does not apply yet
 * (`upcoming`, with the first day when one is fixed). ABSENT declares nothing and the text is treated as applying:
 * there is no third declared state "applies", because that would be a claim nobody made.
 *
 * The failure this exists to prevent is the one a reader cannot see from the text: a repealed provision reads exactly
 * like a current one, and a provision of a regime that has been postponed reads like one in force. So every surface that
 * serves such a record says so in the library's own words (a note, `src/tools/notes.ts`; a banner on a rendered
 * playbook, `src/render.ts`), and ranking gives repealed text a prior so current law outranks it on the same words
 * (`src/search.ts`, `src/brief.ts`). The sentence is computed here, once, from the declaration, a `today` that is a
 * PARAMETER (never stored) and, when the caller asked about a past date, that date.
 *
 * Pure: no I/O. Notes are answer-bearing text (language rule, `src/language.ts`): no identifier, none of the banned
 * terms. The `reason` is the corpus's own sentence and is repeated as it stands.
 */
import { whenPhrase } from "./pending.ts";
import type { Applicability, RegulationId } from "./schema.ts";

/** What a search or a route multiplies the score of repealed text by: it stays in the results, below current law. */
export const HISTORICAL_PRIOR = 0.5;

/** The prior on `record`'s score from its applicability: repealed text at half, everything else untouched. */
export const applicabilityPrior = (record: { applicability?: Applicability | undefined }): number =>
  record.applicability?.status === "historical" ? HISTORICAL_PRIOR : 1;

export const isHistorical = (record: { applicability?: Applicability | undefined }): boolean => record.applicability?.status === "historical";

/** What kind of thing a sentence is about; it picks the grammatical subject. */
export type ApplicabilitySubject = "provision" | "check" | "test" | "playbook";

interface Grammar {
  subject: string;
  /** "applies" / "apply": the verb agrees with the subject. */
  applies: string;
  /** "it" / "they". */
  it: string;
  is: string;
  was: string;
}

const grammar = (subject: ApplicabilitySubject): Grammar =>
  subject === "playbook"
    ? { subject: "The requirements in this playbook", applies: "apply", it: "they", is: "are", was: "were" }
    : { subject: subject === "provision" ? "This text" : subject === "check" ? "This check" : "This test", applies: "applies", it: "it", is: "is", was: "was" };

/** The corpus's reason as a sentence of its own. */
const reasonSentence = (reason: string): string => {
  const r = reason.trim();
  return /[.!?]$/.test(r) ? r : `${r}.`;
};

export interface ApplicabilityWords {
  /** The date `today` is read against, ISO. */
  today: string;
  /** The past date the caller asked about (`as_of`), when they did. */
  asOf?: string | undefined;
  /** What the declaration names as the replacement, as official citations. */
  replacedBy?: readonly string[] | undefined;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: readonly string[]): string => xs.join("; ");

/**
 * What a declaration says about the text in front of the caller.
 *
 * - historical, past `until`: no longer applies, since the day after `until`; under an `as_of` on or before `until` it
 *   applied then and has since ceased to, and after `until` it did not apply then.
 * - historical, `until` not yet reached: still applies, and is recorded as ceasing to. Saying "no longer applies" of
 *   text that still applies would be wrong, which is why `today` is an input and not an assumption.
 * - upcoming with a future `from`: does not apply yet, from that date; with no date, the date is not yet fixed; with a
 *   `from` that has passed, the declaration is behind and the sentence says it cannot say whether it now applies.
 */
export function applicabilityText(a: Applicability, subject: ApplicabilitySubject, words: ApplicabilityWords): string {
  const g = grammar(subject);
  const { today, asOf } = words;
  const replaced = words.replacedBy ?? [];
  if (a.status === "historical") {
    const over = a.until < today;
    const lead =
      asOf === undefined
        ? over
          ? `${g.subject} no longer ${g.applies}: ${g.it} ceased to apply after ${a.until}.`
          : `${g.subject} ${g.is} recorded as ceasing to apply after ${a.until}.`
        : asOf <= a.until
          ? `${g.subject} applied on ${asOf}, the date asked about, ${over ? `but ${g.it} has since ceased to apply: ${g.it} applied until ${a.until}` : `and ${g.it} ${g.is} recorded as ceasing to apply after ${a.until}`}.`
          : `${g.subject} did not apply on ${asOf}, the date asked about: ${g.it} ceased to apply after ${a.until}.`;
    const tail = replaced.length === 0 ? "" : ` ${cap(g.it)} ${over ? g.was : `${g.is} to be`} replaced by ${list(replaced)}.`;
    return `${lead} Reason: ${reasonSentence(a.reason)}${tail}`;
  }
  const notYet = asOf !== undefined && (a.from === undefined || asOf < a.from) ? ` ${cap(g.it)} did not apply on ${asOf}, the date asked about.` : "";
  if (a.from === undefined) return `${g.subject} ${g.is} not yet in application: the date from which ${g.it} ${g.applies} is not yet fixed.${notYet} Reason: ${reasonSentence(a.reason)}`;
  if (a.from > today) return `${g.subject} ${g.is} not yet in application: ${g.it} ${g.applies} from ${a.from}${whenPhrase(today, a.from)}.${notYet} Reason: ${reasonSentence(a.reason)}`;
  return `${g.subject} ${g.is} recorded as applying from ${a.from}, a date that has passed; whether ${g.it} now ${g.applies} is not confirmed here. Reason: ${reasonSentence(a.reason)}`;
}

/**
 * The one-line banner at the top of a rendered playbook: the same declaration, as a quoted line a reader sees before
 * the summary. No `as_of`: a rendered playbook is written from current text and says what it is today.
 */
export function applicabilityBanner(a: Applicability, words: Omit<ApplicabilityWords, "asOf">): string {
  return `> ${applicabilityText(a, "playbook", words).replace(/\s+/g, " ")}`;
}

/** `regulation://` ids a declaration names as the replacement. */
export const replacedByIds = (a: Applicability): readonly RegulationId[] => (a.status === "historical" ? (a.replaced_by ?? []) : []);
