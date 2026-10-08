/**
 * Cross-references between held provisions, from the citations the texts make.
 *
 * `Regulation.cites` names instruments (and provisions of them) a provision refers to. Where the target is held the
 * reference is a link in both directions, and `related` serves it as "this cites" and "cited by". Resolution is the
 * citation resolver's, so a reference is a link only when it matches exactly; one that names an instrument the library
 * does not hold, or is ambiguous, is not a link and is not guessed.
 *
 * Pure over the supplied provisions; the index is built once per list and kept for the life of that list.
 */
import { resolveCitationDetailed } from "./file-adapter.ts";
import type { DocumentHolding, Regulation } from "./schema.ts";

export interface CrossRefs {
  /** What each provision cites, as held provisions. */
  cites: Map<string, string[]>;
  /** Which provisions cite each one. */
  citedBy: Map<string, string[]>;
}

const cache = new WeakMap<readonly Regulation[], CrossRefs>();

export function crossRefs(regulations: readonly Regulation[], holdings?: DocumentHolding[]): CrossRefs {
  const hit = cache.get(regulations);
  if (hit !== undefined) return hit;
  const memo = new Map<string, string | null>();
  const cites = new Map<string, string[]>();
  const citedBy = new Map<string, string[]>();
  for (const r of regulations) {
    for (const c of r.cites ?? []) {
      const key = `${c.citation}\u0000${c.document_id ?? ""}`;
      let target = memo.get(key);
      if (target === undefined) {
        const res = resolveCitationDetailed(regulations as Regulation[], `${c.citation} ${c.document_id ?? ""}`.trim(), holdings);
        target = res.match === null ? null : res.match.id;
        memo.set(key, target);
      }
      if (target === null || target === r.id) continue;
      cites.set(r.id, [...new Set([...(cites.get(r.id) ?? []), target])]);
      citedBy.set(target, [...new Set([...(citedBy.get(target) ?? []), r.id])]);
    }
  }
  const out = { cites, citedBy };
  cache.set(regulations, out);
  return out;
}
