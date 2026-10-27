import { describe, expect, test } from "bun:test";

import { DEMO_PLAYBOOKS } from "../examples/inmemory-demo.ts";
import { routePlaybooks } from "../src/brief.ts";
import { playbookProvisions } from "../src/referrers.ts";
import type { Playbook } from "../src/schema.ts";

const base = Object.values(DEMO_PLAYBOOKS)[0] as Playbook;
const provisions = [...playbookProvisions(base)];

/** A copy of the demo playbook under another id with a title and questions the question does not match. */
const twin = (slug: string): Playbook => ({ ...base, id: `playbook://${slug}` as Playbook["id"], title: `Zzz ${slug}`, questions: [`Qqq ${slug}?`], summary: `Zzz ${slug}.` });

describe("routePlaybooks", () => {
  test("a provision several playbooks cite says less about which one is meant than a provision only one cites", () => {
    const [p1, p2] = provisions as [string, string];
    const withProvisions = (p: Playbook, ids: string[]): Playbook => ({
      ...p,
      requirements: p.requirements.map((r, i) => (i === 0 ? { ...r, provisions: ids.map((id) => ({ id: id as never })) } : { ...r, provisions: [] })),
      basis: [],
      methods: [],
      pitfalls: [],
      excluded: [],
    });
    // p1 ranks first and is cited by three playbooks; p2 ranks second and is cited by one. Unweighted, the three share the
    // top vote and beat the one; weighted, the one that holds the rarer provision leads.
    const crowd = ["a", "b", "c"].map((n) => withProvisions(twin(n), [p1]));
    const lone = withProvisions(twin("d"), [p2]);
    const question = { question: "qq", playbooks: [...crowd, lone], rankedProvisions: [p1, p2] };
    expect(routePlaybooks({ ...question, params: { textWeight: 0 } }).routes[0]?.playbook.id).toBe(lone.id);
    expect(routePlaybooks({ ...question, params: { textWeight: 0, specificity: false } }).routes[0]?.playbook.id).not.toBe(lone.id);
  });

  test("below the floor nothing is chosen, and the reason is said", () => {
    const r = routePlaybooks({ question: "something about nothing in the library", playbooks: [twin("alpha")], rankedProvisions: [] });
    expect(r.chosen).toBeNull();
  });

  test("two equally good fits are ambiguous, and the leader is still chosen", () => {
    const a = twin("alpha");
    const b = twin("beta");
    const r = routePlaybooks({ question: "Qqq alpha beta?", playbooks: [a, b], rankedProvisions: [], params: { floor: 0 } });
    expect(r.ambiguous).toBe(true);
    expect(r.chosen).not.toBeNull();
  });

  test("the head (title, questions) says what a playbook is about; a body that only mentions the words does not outweigh it", () => {
    const about: Playbook = { ...twin("about"), title: "Gamma delta handling", questions: ["How is gamma delta handled?"], summary: "Gamma delta handling.", requirements: base.requirements.map((r) => ({ ...r, title: "Qqq", statement: "Qqq." })) };
    // Mentions the words often in its long statements, as a neighbouring topic does, but is about something else.
    const mentions: Playbook = { ...twin("mentions"), requirements: base.requirements.map((r) => ({ ...r, title: "Qqq", statement: `${"Gamma delta gamma delta applies here. ".repeat(6)}Other matters follow at length.` })) };
    const question = { question: "gamma delta", playbooks: [mentions, about], rankedProvisions: [] as string[], params: { floor: 0 } };
    expect(routePlaybooks(question).routes[0]?.playbook.id).toBe(about.id);
    // The body alone prefers the neighbour: it is the head that settles it.
    expect(routePlaybooks({ ...question, params: { floor: 0, headWeight: 0 } }).routes[0]?.playbook.id).toBe(mentions.id);
    expect(routePlaybooks({ ...question, params: { floor: 0, headWeight: 1 } }).routes[0]?.playbook.id).toBe(about.id);
  });
});
