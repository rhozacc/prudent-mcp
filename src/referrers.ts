/**
 * The ONE computed reverse index over cross-surface references.
 *
 * Every adapter's `meta.referrers` must delegate here so "what points at this
 * ID" has exactly one definition. Pure over the supplied arrays — callers pass
 * whatever their backend holds (a corpus file's arrays, Object.values of seed
 * maps, ...).
 *
 * A referrer is any record that names `id` through a typed reference:
 *   - regulation: `parent` or `children`
 *   - test:       `regulatory_basis` or `parent`
 *   - check:      `derived_from` or `parent`
 *   - playbook:   cites the provision anywhere (`playbookProvisions`)
 *
 * `primary` splits out the checks/tests naming `id` in their optional
 * `primary_basis` — the provision they restate, as against the span they were
 * traced to. Without it the index cannot discriminate: `derived_from` commonly
 * names a whole section, so every article in that section gets an identical
 * answer.
 *
 * The mirror invariant (CLAUDE.md) makes the `children` scan mostly redundant
 * with the child-side scans for well-formed corpora, but scanning both sides
 * keeps the index truthful on corpora the linter hasn't blessed.
 */
import type {
  Check,
  Playbook,
  Referrers,
  Regulation,
  RegulationChildId,
  RegulationId,
  Test,
} from "./schema.ts";

/**
 * Every provision a playbook cites, anywhere: its basis, its requirements, its methods and its pitfalls. Provisions it
 * lists as `excluded` are members it chose not to cite and are not included.
 */
export function playbookProvisions(p: Playbook): Set<RegulationId> {
  const ids = new Set<RegulationId>();
  for (const b of p.basis) for (const r of b.provisions) ids.add(r.id);
  for (const r of p.requirements) for (const x of r.provisions) ids.add(x.id);
  for (const m of p.methods) for (const id of m.provisions) ids.add(id);
  for (const pit of p.pitfalls) for (const id of pit.provisions) ids.add(id);
  return ids;
}

export interface ReferrersInput {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
}

export function computeReferrers(input: ReferrersInput, id: string): Referrers {
  // The scans below compare against typed arrays; a plain string that is not a
  // well-formed URI simply never matches, so the casts are safe.
  const asRegulation = id as RegulationId;
  const asChild = id as RegulationChildId;

  return {
    regulation: input.regulation
      .filter((r) => r.parent === asRegulation || r.children.includes(asChild))
      .map((r) => r.id),
    tests: input.tests
      .filter((t) => t.regulatory_basis.includes(asRegulation) || t.parent === asRegulation)
      .map((t) => t.id),
    checks: input.checks
      .filter((c) => c.derived_from.includes(asRegulation) || c.parent === asRegulation)
      .map((c) => c.id),
    playbooks: input.playbooks.filter((p) => playbookProvisions(p).has(asRegulation)).map((p) => p.id),
    primary: {
      tests: input.tests
        .filter((t) => t.primary_basis?.includes(asRegulation) === true)
        .map((t) => t.id),
      checks: input.checks
        .filter((c) => c.primary_basis?.includes(asRegulation) === true)
        .map((c) => c.id),
    },
  };
}
