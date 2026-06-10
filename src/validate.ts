/**
 * Corpus integrity invariants — extracted from scripts/validate-corpus.ts so
 * the checks are importable as a library.
 *
 * Pure functions, no I/O: pass in the four surface arrays (already loaded
 * through whatever adapter the caller has) and get back a list of human-
 * readable violations. Empty list ⇒ corpus is sound.
 *
 * The CLI in scripts/validate-corpus.ts is now a thin wrapper around
 * `validateCorpus` — it loads adapters and prints results. Anyone else who
 * has a CorpusFile in hand can call `validateCorpusFile` and get the same
 * guarantees without spawning a process.
 *
 * Invariants checked:
 *   1. Mirror invariant — a check/test in Regulation.children points back via
 *      parent AND names that regulation in derived_from / regulatory_basis.
 *   2. Parent/children are bidirectional for regulation nesting.
 *   3. No dangling references — every URI (children, parent, derived_from,
 *      regulatory_basis, regulatory_scope, phase references) resolves.
 *   4. No cycles in the regulation parent chain.
 */
import type {
  Check,
  Playbook,
  Regulation,
  Test,
} from "./schema.ts";

export interface CorpusInput {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
}

/**
 * Validate a corpus and return a deduplicated list of human-readable
 * violations. Empty array means the corpus passes every invariant.
 */
export function validateCorpus(corpus: CorpusInput): string[] {
  const { regulation: regs, tests, checks, playbooks } = corpus;

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

  // 3 — dangling references on the curated surfaces.
  for (const c of checks) {
    for (const r of c.derived_from) if (!regIds.has(r)) errors.push(`${c.id}: derived_from ${r} does not resolve`);
    if (c.parent !== undefined && !regIds.has(c.parent)) errors.push(`${c.id}: parent ${c.parent} does not resolve`);
  }
  for (const t of tests) {
    for (const r of t.regulatory_basis) if (!regIds.has(r)) errors.push(`${t.id}: regulatory_basis ${r} does not resolve`);
    if (t.parent !== undefined && !regIds.has(t.parent)) errors.push(`${t.id}: parent ${t.parent} does not resolve`);
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

  return [...new Set(errors)];
}

/**
 * Convenience wrapper for callers who hold a CorpusFile (the on-disk shape
 * produced by loadCorpusFile). Picks the four surface arrays and runs
 * validateCorpus.
 */
export function validateCorpusFile(corpus: {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
}): string[] {
  return validateCorpus({
    regulation: corpus.regulation,
    tests: corpus.tests,
    checks: corpus.checks,
    playbooks: corpus.playbooks,
  });
}
