/**
 * Routing: which playbook answers a question.
 *
 * Two signals, both computed from what the library already ranks, combined by a fixed rule:
 *
 * - TEXT: BM25F over each playbook's title, typical questions, summary and requirements (the same ranking module as every
 *   other search), with the library's abbreviation table applied.
 * - VOTE: the provisions the question finds, in rank order. Each provision that a playbook cites gives that playbook
 *   1/rank, so a playbook whose provisions are the ones a practitioner's wording lands on wins even when its own prose
 *   uses other words ("RDS" in the question, "reference data set" in the text).
 *
 * A playbook is chosen only when it clears an absolute floor; when none does, the caller says so and offers passages
 * instead (a confident wrong playbook is worse than none). When the runner-up is within a margin of the leader the leader
 * is still chosen but the answer names the other, because two neighbouring topics can both bear on one question. The constants are tuned on
 * a practitioner question bank held outside this repository and are named here with the bank's version so they are
 * changed on evidence, not by feel.
 *
 * Pure: ranked inputs in, a decision out.
 */
import { distinctQueryTokens, playbookSearchFields, rankedSearch, type Glossary } from "./search.ts";
import { playbookProvisions } from "./referrers.ts";
import type { Playbook, RegulationId } from "./schema.ts";

/** The question bank these constants were tuned on. */
export const ROUTING_BANK_VERSION = "practitioner-v1";

export const ROUTING = {
  /** Provision hits that vote. */
  voteDepth: 40,
  /** Weight of the text signal against the vote (the vote gets the rest). */
  textWeight: 0.5,
  /** The combined score a playbook must reach to be chosen at all, 0-1. */
  floor: 0.35,
  /** The leader is "ambiguous" when it leads the runner-up by less than this share of its own score. */
  margin: 0.12,
  /** A playbook within this fraction of the leader's score is offered as a neighbour. */
  neighbour: 0.5,
} as const;

export interface Route {
  playbook: Playbook;
  /** Text signal, 0-1: half the BM25F score against the best, half the share of the question's terms the playbook matches. */
  text: number;
  /** Vote signal, 0-1 (reciprocal-rank vote against a fixed yardstick). */
  vote: number;
  score: number;
}

export interface Routing {
  /** Every playbook that scored, best first. */
  routes: Route[];
  /** The playbook chosen, or null when none clears the floor. */
  chosen: Route | null;
  /** The runner-up is close behind the chosen playbook: the answer should name it, not only the leader. */
  ambiguous: boolean;
  /** Why nothing was chosen, for the caller and for tuning. */
  reason?: "no_playbooks" | "no_match" | "below_floor";
  /** Other playbooks close enough to the chosen one to be worth naming. */
  neighbours: Route[];
}

export function routePlaybooks(args: {
  question: string;
  playbooks: readonly Playbook[];
  /** Provision ids the question found, best first. */
  rankedProvisions: readonly string[];
  glossary?: Glossary | undefined;
}): Routing {
  const { question, playbooks } = args;
  if (playbooks.length === 0) return { routes: [], chosen: null, ambiguous: false, reason: "no_playbooks", neighbours: [] };

  const matches = rankedSearch([...playbooks], question, playbookSearchFields, undefined, args.glossary === undefined ? undefined : { glossary: args.glossary });
  const topBm25 = matches[0]?.score ?? 0;
  const tokens = Math.max(1, distinctQueryTokens(question));
  const textOf = new Map(matches.map((m) => [m.record.id, (0.5 * (topBm25 > 0 ? m.score / topBm25 : 0)) + 0.5 * Math.min(1, m.coverage / tokens)] as const));

  const cites = new Map(playbooks.map((p) => [p.id, playbookProvisions(p)] as const));
  const vote = new Map<string, number>();
  args.rankedProvisions.slice(0, ROUTING.voteDepth).forEach((id, i) => {
    for (const p of playbooks) if (cites.get(p.id)!.has(id as RegulationId)) vote.set(p.id, (vote.get(p.id) ?? 0) + 1 / (i + 1));
  });
  // The best a playbook could do is own every one of the first few hits: the vote is read against that fixed yardstick,
  // not against the best playbook, so a topic nobody cites cannot look strong by being the least weak.
  const yardstick = [1, 2, 3, 4, 5].reduce((n, r) => n + 1 / r, 0);

  const routes: Route[] = playbooks
    .map((playbook) => {
      const text = textOf.get(playbook.id) ?? 0;
      const v = Math.min(1, (vote.get(playbook.id) ?? 0) / yardstick);
      return { playbook, text, vote: v, score: ROUTING.textWeight * text + (1 - ROUTING.textWeight) * v };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.playbook.id < b.playbook.id ? -1 : 1));

  const lead = routes[0];
  if (lead === undefined) return { routes, chosen: null, ambiguous: false, reason: "no_match", neighbours: [] };
  if (lead.score < ROUTING.floor) return { routes, chosen: null, ambiguous: false, reason: "below_floor", neighbours: [] };
  const second = routes[1];
  const ambiguous = second !== undefined && lead.score - second.score < ROUTING.margin * lead.score;
  return { routes, chosen: lead, ambiguous, neighbours: routes.slice(1).filter((r) => r.score >= ROUTING.neighbour * lead.score).slice(0, 2) };
}
