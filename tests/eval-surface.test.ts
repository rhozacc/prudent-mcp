import { describe, expect, it } from "bun:test";

import type { CallTrace, Session } from "../evals/harness.ts";
import { costWithinBudget, idsRoundTrip, missesAreActionable, totalsAreTruthful } from "../evals/invariants.ts";

// ── I4–I7 on stand-in sessions that speak the 1.0 tools ──────────────────────────────────────────────────────────────
//
// Each invariant has to be able to fail, so each is run against a server that is wrong in the one way it exists to catch.

type Reply = { json?: unknown; text?: string; isError?: boolean; tokens?: number };

function session(handler: (tool: string, args: Record<string, unknown>) => Reply, tools = ["brief", "playbook", "topics", "search", "get", "cite", "related", "sources"]): Session {
  return {
    tools: tools.map((name) => ({ name, description: "", schemaText: "{}", schemaChars: 2, tokens: 1 })),
    surfaceTokens: 1,
    wireTokens: 1,
    instructions: "",
    traces: [],
    async close() {},
    async call(tool, args = {}): Promise<CallTrace> {
      const r = handler(tool, args);
      const text = r.text ?? JSON.stringify(r.json ?? {});
      return { tool, args, text, chars: text.length, tokens: r.tokens ?? Math.round(text.length / 4), ms: 0, isError: r.isError === true, json: r.json ?? null };
    },
  };
}

const ids = (scope: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${scope}://a/${i}` }));
const COUNTS = { counts: { regulation: 500, check: 1, test: 1 }, documents: [] };

describe("I4 reads search by scope", () => {
  const honest = (tool: string, args: Record<string, unknown>): Reply => {
    if (tool === "sources") return { json: COUNTS };
    const wide = String(args["query"]).length > 10;
    return { json: { results: ids("regulation", 3), total_matches: wide ? 40 : 20 } };
  };

  it("passes a total that widens with the query", async () => {
    const r = await totalsAreTruthful(session(honest));
    expect(r.applicable).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("is fatal when a wider query reports fewer matches, and names the scope", async () => {
    const r = await totalsAreTruthful(session((t, a) => (t === "search" && a["scope"] === "checks" && String(a["query"]).length > 10 ? { json: { results: [], total_matches: 1 } } : honest(t, a))));
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([["I4/search/checks-monotonic", "fatal"]]);
  });

  it("is fatal when the total is a page size across a large surface", async () => {
    const r = await totalsAreTruthful(session((t, a) => (t === "search" ? { json: { results: ids("regulation", 100), total_matches: 100 } } : honest(t, a))));
    expect(r.findings.some((f) => f.id === "I4/search/provisions-capped" && f.severity === "fatal")).toBe(true);
  });
});

describe("I5 follows the ids sources, topics and search hand out", () => {
  it("is fatal for an id a topic hands out that playbook cannot open", async () => {
    const r = await idsRoundTrip(
      session((tool, args) => {
        if (tool === "topics") return { json: { areas: [{ id: "x", playbooks: [{ id: "playbook://gone" }] }] } };
        if (tool === "playbook") return { isError: true, text: `No playbook ${String(args["id"])}.` };
        return { json: {} };
      }),
    );
    expect(r.findings.map((f) => f.id)).toEqual(["I5/playbook://gone"]);
  });
});

describe("I6 prices the entry path and the playbook bundle", () => {
  const menu = { json: { areas: [{ id: "x", playbooks: [{ id: "playbook://p", title: "A topic" }] }] } };
  const base = (over: Record<string, Reply>) => (tool: string): Reply => over[tool] ?? (tool === "topics" ? menu : { json: {} });

  it("is quiet when everything is small", async () => {
    expect((await costWithinBudget(session(base({})))).findings).toEqual([]);
  });

  it("warns when topics and brief together cost more than the entry budget", async () => {
    const r = await costWithinBudget(session(base({ brief: { tokens: 9000 } })));
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([["I6/entry-path", "warn"]]);
  });

  it("is fatal for a search page, or a playbook, over its ceiling", async () => {
    const r = await costWithinBudget(session(base({ playbook: { tokens: 9500 } })));
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([["I6/playbook", "fatal"]]);
    const s = await costWithinBudget(session((tool, args) => (tool === "search" && args["scope"] === "checks" ? { tokens: 6500 } : base({})(tool))));
    expect(s.findings.map((f) => f.id)).toEqual(["I6/search/checks"]);
  });
});

describe("I7 probes the misses of get, playbook and related", () => {
  const miss = (text: string): Reply => ({ isError: true, text });

  it("passes misses that name different tools", async () => {
    const r = await missesAreActionable(
      session((tool, args) => {
        if (tool === "get") return miss(String(args["ids"]).startsWith("check") ? "No entry. Verify with search." : "No provision. Verify with search or cite.");
        if (tool === "playbook") return miss("No playbook with that id. topics lists them.");
        return miss("No provision. Use sources to see what is held.");
      }),
    );
    expect(r.findings).toEqual([]);
  });

  it("is fatal when a nonsense id is answered without an error", async () => {
    const r = await missesAreActionable(session((tool) => (tool === "related" ? { json: { id: "x" } } : miss("Try search."))));
    expect(r.findings.some((f) => f.id === "I7/related-silent" && f.severity === "fatal")).toBe(true);
  });

  it("warns when a miss names no tool, and when every miss says the same thing", async () => {
    const none = await missesAreActionable(session((tool) => (tool === "playbook" ? miss("Not found.") : miss("Try search."))));
    expect(none.findings.map((f) => f.id)).toContain("I7/playbook-unrouted");
    const same = await missesAreActionable(session(() => miss("Try search.")));
    expect(same.findings.map((f) => f.id)).toContain("I7/undifferentiated");
  });

  it("does not take the word 'target' for a route to get", async () => {
    const r = await missesAreActionable(session(() => miss("Not the target you wanted.")));
    expect(r.findings.filter((f) => f.id.endsWith("-unrouted")).length).toBe(4);
  });
});
