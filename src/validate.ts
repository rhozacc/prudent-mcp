/**
 * Corpus integrity invariants — extracted from scripts/validate-corpus.ts so
 * the checks are importable as a library.
 *
 * Pure functions, no I/O: pass in the surface arrays (already loaded through
 * whatever adapter the caller has) and get back a list of human-readable
 * violations. Empty list ⇒ corpus is sound. Rules that depend on "today"
 * take an injectable `now` (defaulting to the wall clock) so callers and
 * tests stay deterministic.
 *
 * The CLI in scripts/validate-corpus.ts is now a thin wrapper around
 * `validateCorpus` — it loads adapters and prints results. Anyone else who
 * has a CorpusFile in hand can call `validateCorpusFile` and get the same
 * guarantees without spawning a process.
 *
 * Invariants checked:
 *   1. Mirror invariant — a check/test in Regulation.children points back via
 *      parent AND names that regulation in derived_from / regulatory_basis;
 *      conversely (rule 3) a check/test that claims a parent must be listed in
 *      that parent's children and name it in derived_from / regulatory_basis.
 *   2. Parent/children are bidirectional for regulation nesting.
 *   3. No dangling references — every URI (children, parent, derived_from,
 *      regulatory_basis, regulatory_scope, phase references) resolves.
 *   4. No cycles in the regulation parent chain.
 *   5. Source registry coherence — unique ids; superseded status and the
 *      superseded_by pointer imply each other; pointers resolve and the
 *      supersession chain is acyclic; verified dates are not in the future.
 *   6. Verbatim invariant — no HTML markup in the fields whose promise is
 *      reproduction of the source document (the covered set, and the reasons
 *      for the exclusions, are enumerated above `validateCorpus`).
 *   7. URI-safe ids — no character that a URI stops at when written into
 *      ordinary prose, because an id is copied out of one response and pasted
 *      into the next call.
 *
 * Staleness (a current source whose `verified` is older than
 * STALE_AFTER_DAYS) is advisory, not fatal — see `corpusWarnings`.
 */
import { holdingsWarnings } from "./holdings.ts";
import type {
  Check,
  Playbook,
  Regulation,
  Source,
  SourceId,
  Test,
} from "./schema.ts";

export interface CorpusInput {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
  sources?: Source[];   // optional so pre-sources callers keep working unchanged
}

// --- Source currency ----------------------------------------------------------

/** A current source whose `verified` date is older than this many days is stale. */
export const STALE_AFTER_DAYS = 30;

/**
 * IDs of current sources whose `verified` date is more than STALE_AFTER_DAYS
 * old. Dates compare lexicographically as ISO strings (the convention across
 * the codebase); `now` is injectable so tests stay deterministic.
 */
export function staleSourceIds(sources: Source[], now: Date = new Date()): SourceId[] {
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
  return sources
    .filter((s) => s.status === "current" && s.verified < cutoff)
    .map((s) => s.id);
}

// --- Verbatim text ------------------------------------------------------------

/**
 * An actual HTML tag: `<sub>`, `</sub>`, `<br/>`, `<span class="x">`.
 *
 * Deliberately NOT a bare `/[<>]/` test. Regulation text is full of
 * mathematical comparators — "PD < 0.03", "p-value > α", "LGD >= 0" — and a
 * naive check would fail on real law. So a match needs the tag shape: `<`,
 * an optional closing slash, an element name starting with a letter, then
 * either the closing `>` (with an optional self-closing slash) or one or more
 * `name="value"` attributes.
 *
 * Requiring `=` on attributes is what keeps prose like "if x<y and z>0" from
 * matching: "y and z" would otherwise read as valueless boolean attributes.
 * The residual false positive is prose that writes a comparison as `a<b>c`
 * with no spaces — indistinguishable from a tag, and vanishingly rare in
 * drafted regulation.
 *
 * Scope is HTML tags only. Markdown emphasis (`*`, `_`) is not checked: those
 * characters are legitimate in this corpus (multiplication, footnote markers,
 * `PD_i`-style subscript notation), so a rule on them would be false positives
 * all the way down. The markdown half of the promise lives in the server
 * `instructions` string, which is guidance rather than enforcement.
 */
const HTML_TAG =
  /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))*\s*\/?>/;

/**
 * The first HTML tag in `value`, or undefined if there is none. Exported so a
 * corpus-producing pipeline can run the same test before writing a record.
 */
export function findMarkup(value: string): string | undefined {
  return HTML_TAG.exec(value)?.[0] ?? undefined;
}

/**
 * Which fields rule 6 covers, and why the rest are out.
 *
 * COVERED — text the corpus promises to reproduce as the source document
 * writes it, and that an analyst pastes into a validation report or finding.
 * Markup here means the quote is no longer verbatim, which is a correctness
 * failure, not a style nit:
 *   Regulation.text                 the provision itself
 *   Regulation.citation             the locator quoted beside it
 *   Regulation.commentary[].source  the attribution of an interpretive quote
 *   Regulation.commentary[].text    the quoted Q&A / supervisor wording
 *   Check.expectation               the bar quoted into a finding
 *   Test.acceptance_criteria        the pass/fail wording quoted into a report
 *
 * NOT COVERED, on purpose:
 *   - Curated editorial prose written for this corpus rather than reproduced
 *     from a document — Test.name/purpose, Check.name, Playbook.gates,
 *     Phase.name/description, Source.title/notes, ReviewArea.name. Markup
 *     there would be a formatting slip, not a broken quote.
 *   - Short enumerated labels — Check.expected_evidence, Test.aliases,
 *     Source.milestones[].event. Same reasoning, and nothing quotes them as
 *     source wording.
 *   - Ids, URIs, frameworks, document ids/versions, dates and enums. Already
 *     format-constrained by the zod schemas and the reference rules above; a
 *     tag in one of those fails earlier and louder.
 *
 * Promoting a field into the covered set is a deliberate call — it makes any
 * existing corpus with markup in that field fatally invalid until cleaned.
 */

/**
 * Validate a corpus and return a deduplicated list of human-readable
 * violations. Empty array means the corpus passes every invariant.
 */
export function validateCorpus(corpus: CorpusInput, now: Date = new Date()): string[] {
  const { regulation: regs, tests, checks, playbooks, sources = [] } = corpus;

  const regIds = new Set<string>(regs.map((r) => r.id));
  const checkIds = new Set<string>(checks.map((c) => c.id));
  const testIds = new Set<string>(tests.map((t) => t.id));
  const playbookIds = new Set<string>(playbooks.map((p) => p.id));
  const regById = new Map<string, Regulation>(regs.map((r) => [r.id, r]));
  const checkById = new Map<string, Check>(checks.map((c) => [c.id, c]));
  const testById = new Map<string, Test>(tests.map((t) => [t.id, t]));

  const errors: string[] = [];

  const resolves = (id: string): boolean => {
    if (id.startsWith("regulation://")) return regIds.has(id);
    if (id.startsWith("test://")) return testIds.has(id);
    if (id.startsWith("check://")) return checkIds.has(id);
    if (id.startsWith("playbook://")) return playbookIds.has(id);
    return false;
  };

  // 1 + 2 + 3 — walk every regulation's structural and operational links.
  for (const reg of regs) {
    if (reg.parent !== undefined) {
      if (!regIds.has(reg.parent)) {
        errors.push(`${reg.id}: parent ${reg.parent} does not resolve`);
      } else if (!regById.get(reg.parent)!.children.includes(reg.id)) {
        errors.push(`${reg.id}: parent ${reg.parent} does not list it in children (parent/children not bidirectional)`);
      }
    }

    for (const childId of reg.children) {
      if (!resolves(childId)) {
        errors.push(`${reg.id}: child ${childId} does not resolve`);
        continue;
      }
      if (childId.startsWith("regulation://")) {
        if (regById.get(childId)!.parent !== reg.id) {
          errors.push(`${reg.id}: regulation child ${childId} does not point back via parent`);
        }
      } else if (childId.startsWith("check://")) {
        const child = checkById.get(childId)!;
        if (child.parent !== reg.id) errors.push(`${reg.id}: check child ${childId} has parent ${child.parent ?? "(none)"}, expected ${reg.id}`);
        if (!child.derived_from.includes(reg.id)) errors.push(`${reg.id}: check child ${childId} does not list it in derived_from (mirror invariant)`);
      } else if (childId.startsWith("test://")) {
        const child = testById.get(childId)!;
        if (child.parent !== reg.id) errors.push(`${reg.id}: test child ${childId} has parent ${child.parent ?? "(none)"}, expected ${reg.id}`);
        if (!child.regulatory_basis.includes(reg.id)) errors.push(`${reg.id}: test child ${childId} does not list it in regulatory_basis (mirror invariant)`);
      } else {
        errors.push(`${reg.id}: child ${childId} is not a valid child surface (regulation/test/check only)`);
      }
    }
  }

  // 3 — dangling references on the curated surfaces, plus the child-side half of
  // the mirror invariant: a check/test that claims a parent must be listed in
  // that parent's children and must name it in derived_from / regulatory_basis
  // (rule 1 only enforces this from the Regulation.children side).
  for (const c of checks) {
    for (const r of c.derived_from) if (!regIds.has(r)) errors.push(`${c.id}: derived_from ${r} does not resolve`);
    if (c.parent !== undefined) {
      if (!regIds.has(c.parent)) {
        errors.push(`${c.id}: parent ${c.parent} does not resolve`);
      } else {
        if (!regById.get(c.parent)!.children.includes(c.id)) errors.push(`${c.id}: parent ${c.parent} does not list it in children (mirror invariant)`);
        if (!c.derived_from.includes(c.parent)) errors.push(`${c.id}: parent ${c.parent} not in derived_from (mirror invariant)`);
      }
    }
  }
  for (const t of tests) {
    for (const r of t.regulatory_basis) if (!regIds.has(r)) errors.push(`${t.id}: regulatory_basis ${r} does not resolve`);
    if (t.parent !== undefined) {
      if (!regIds.has(t.parent)) {
        errors.push(`${t.id}: parent ${t.parent} does not resolve`);
      } else {
        if (!regById.get(t.parent)!.children.includes(t.id)) errors.push(`${t.id}: parent ${t.parent} does not list it in children (mirror invariant)`);
        if (!t.regulatory_basis.includes(t.parent)) errors.push(`${t.id}: parent ${t.parent} not in regulatory_basis (mirror invariant)`);
      }
    }
  }
  for (const p of playbooks) {
    for (const r of p.regulatory_scope) if (!regIds.has(r)) errors.push(`${p.id}: regulatory_scope ${r} does not resolve`);
    for (const ph of p.phases) for (const ref of ph.references) if (!resolves(ref)) errors.push(`${p.id} / "${ph.name}": reference ${ref} does not resolve`);
  }

  // 4 — cycles in the regulation parent chain.
  for (const reg of regs) {
    const seen = new Set<string>();
    let cursor: string | undefined = reg.id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        errors.push(`parent cycle reachable from ${reg.id} (revisits ${cursor})`);
        break;
      }
      seen.add(cursor);
      cursor = regById.get(cursor)?.parent;
    }
  }

  // 5 — source registry coherence (currency layer). Unique ids get a rule the
  // other surfaces don't have because supersession pointers make duplicates
  // uniquely dangerous: two records with one id can't both be the chain target.
  const sourceIds = new Set<string>();
  for (const s of sources) {
    if (sourceIds.has(s.id)) errors.push(`duplicate source id ${s.id}`);
    sourceIds.add(s.id);
  }
  const sourceById = new Map<string, Source>(sources.map((s) => [s.id, s]));
  const today = now.toISOString().slice(0, 10);
  for (const s of sources) {
    if (s.status === "superseded" && s.superseded_by === undefined) {
      errors.push(`${s.id}: status superseded but superseded_by missing (supersession invariant)`);
    }
    if (s.superseded_by !== undefined) {
      if (s.status !== "superseded") {
        errors.push(`${s.id}: superseded_by set but status is ${s.status} (supersession invariant)`);
      }
      if (!sourceIds.has(s.superseded_by)) {
        errors.push(`${s.id}: superseded_by ${s.superseded_by} does not resolve`);
      }
    }
    if (s.verified > today) errors.push(`${s.id}: verified ${s.verified} is in the future`);
  }
  // Cycles in the supersession chain (a self-reference is the 1-cycle) — a
  // cyclic chain never terminates at a current/pending document.
  for (const s of sources) {
    const seen = new Set<string>();
    let cursor: string | undefined = s.id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        errors.push(`supersession cycle reachable from ${s.id} (revisits ${cursor})`);
        break;
      }
      seen.add(cursor);
      cursor = sourceById.get(cursor)?.superseded_by;
    }
  }

  // 6 — verbatim invariant. The covered set and the reasoning behind the
  // exclusions are documented above this function. Fatal, not advisory: a
  // provision carrying markup no longer matches the document it cites.
  const verbatim = (id: string, field: string, value: string | undefined): void => {
    if (value === undefined) return;
    const tag = findMarkup(value);
    if (tag !== undefined) {
      errors.push(`${id}: ${field} contains HTML markup ${tag} (verbatim invariant)`);
    }
  };
  for (const reg of regs) {
    verbatim(reg.id, "text", reg.text);
    verbatim(reg.id, "citation", reg.citation);
    reg.commentary.forEach((c, i) => {
      verbatim(reg.id, `commentary[${i}].source`, c.source);
      verbatim(reg.id, `commentary[${i}].text`, c.text);
    });
  }
  for (const c of checks) verbatim(c.id, "expectation", c.expectation);
  for (const t of tests) verbatim(t.id, "acceptance_criteria", t.acceptance_criteria);

  // 7 — ids must survive being written down.
  //
  // A record id is not only a key: it is copied out of one response and pasted
  // into the next call, usually by a model reproducing it inside prose. Any
  // character that terminates a URI in ordinary text — a bracket, a quote, a
  // trailing "+" — gets eaten on the way, and the id that comes back is a
  // truncated one that resolves to nothing. Observed live: an id ending in
  // "(part2)" reached get_check as "…/2(part2", which reads to the caller as
  // "that record does not exist".
  //
  // Fatal rather than advisory: the corpus decides its own ids, so this is
  // always fixable at the source, and the failure it causes is silent.
  const UNSAFE_ID_CHARS = /[^A-Za-z0-9:/._-]/g;
  const idSafe = (id: string): void => {
    const bad = [...new Set(id.match(UNSAFE_ID_CHARS) ?? [])];
    if (bad.length > 0) {
      errors.push(
        `${id}: id contains ${bad.map((c) => `'${c}'`).join(", ")} — ids must use only ` +
          "letters, digits and : / . _ - so they survive being quoted in prose (URI-safe id)",
      );
    }
  };
  for (const reg of regs) idSafe(reg.id);
  for (const t of tests) idSafe(t.id);
  for (const c of checks) idSafe(c.id);
  for (const p of playbooks) idSafe(p.id);
  for (const s of sources) idSafe(s.id);

  return [...new Set(errors)];
}

/**
 * Advisory currency findings — separate from validateCorpus so callers and
 * the CLI can keep them non-fatal: a stale source needs re-verification
 * against the publisher, not a failed build.
 */
export function corpusWarnings(corpus: CorpusInput, now: Date = new Date()): string[] {
  const sources = corpus.sources ?? [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const stale = staleSourceIds(sources, now).map((id) => {
    const s = byId.get(id)!;
    return `${id}: verified ${s.verified} is older than ${STALE_AFTER_DAYS} days (stale)`;
  });
  return [...stale, ...holdingsWarnings(corpus.regulation, sources)];
}

/**
 * Convenience wrapper for callers who hold a CorpusFile (the on-disk shape
 * produced by loadCorpusFile). Picks the surface arrays and runs
 * validateCorpus.
 */
export function validateCorpusFile(corpus: {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
  sources?: Source[];
}): string[] {
  return validateCorpus({
    regulation: corpus.regulation,
    tests: corpus.tests,
    checks: corpus.checks,
    playbooks: corpus.playbooks,
    ...(corpus.sources !== undefined ? { sources: corpus.sources } : {}),
  });
}
