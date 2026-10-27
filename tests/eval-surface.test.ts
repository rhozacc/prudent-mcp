import { describe, expect, it } from "bun:test";

import type { CallTrace, Session } from "../evals/harness.ts";
import { asOfIsNeverSilentlySubstituted, costWithinBudget, declinesAreNeverEmpty, humanRegisterCitationsResolve, idsRoundTrip, missesAreActionable, totalsAreTruthful } from "../evals/invariants.ts";

// ── I4–I7, I9–I11 on stand-in sessions that speak the 1.0 tools ──────────────────────────────────────────────────────────────
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

describe("I9 and I10 read the outside_library note of cite", () => {
  const search = (): Reply => ({ json: { results: [{ id: "regulation://a/1", citation: "Article 181" }] } });
  const note = (text: string) => [{ type: "outside_library", text }];
  const answering = (reply: Reply) => (tool: string): Reply => (tool === "search" ? search() : reply);

  it("I9 is fatal for a decline with no match, candidate or note", async () => {
    const r = await humanRegisterCitationsResolve(session(answering({ json: { match: null, confidence: "none", candidates: [] } })));
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([["I9/bare-miss", "fatal"]]);
  });

  it("I9 accepts a note as the reason, and rejects a neighbour offered as a candidate", async () => {
    const withNote = await humanRegisterCitationsResolve(session(answering({ json: { match: null, notes: note("Nothing in this library is numbered 181(1).") } })));
    expect(withNote.findings).toEqual([]);
    expect(withNote.applicable).toBe(true);
    const neighbour = await humanRegisterCitationsResolve(session(answering({ json: { match: null, candidates: [{ id: "regulation://a/2", citation: "Article 182" }] } })));
    expect(neighbour.findings.map((f) => f.id)).toEqual(["I9/candidate-unrelated"]);
  });

  it("I10 is fatal for a silent decline and warns for a note that never mentions what was asked", async () => {
    const silent = await declinesAreNeverEmpty(session(() => ({ json: { match: null } })));
    expect(silent.findings.map((f) => f.id)).toEqual(["I10/silent-decline", "I10/silent-decline", "I10/silent-decline", "I10/silent-decline"]);
    const generic = await declinesAreNeverEmpty(session(() => ({ json: { match: null, notes: note("Not held.") } })));
    expect(generic.findings.every((f) => f.id === "I10/generic-decline" && f.severity === "warn")).toBe(true);
    const good = await declinesAreNeverEmpty(session((_t, a) => ({ json: { match: null, notes: note(`This library holds no "${String(a["text"])}".`) } })));
    expect(good.findings).toEqual([]);
  });

  it("I10 does not judge a citation that resolved", async () => {
    const r = await declinesAreNeverEmpty(session(() => ({ json: { match: { id: "regulation://a/1" } } })));
    expect(r.applicable).toBe(false);
  });
});

describe("I11 reads the version note of get", () => {
  const record = { id: "regulation://a/1", document_version: "2024-05-01", text: "Synthetic text." };
  const server = (note: (asOf: string) => string | undefined) => (tool: string, args: Record<string, unknown>): Reply => {
    if (tool === "search") return { json: { results: [{ id: record.id, document_id: "a" }] } };
    const asOf = args["as_of"];
    const text = typeof asOf === "string" ? note(asOf) : undefined;
    return { json: { ...(text === undefined ? {} : { notes: [{ type: "version", text }] }), records: [record] } };
  };

  it("is fatal when the current text is served under a past date with no note", async () => {
    const r = await asOfIsNeverSilentlySubstituted(session(server(() => undefined)));
    expect(r.applicable).toBe(true);
    expect(r.findings.map((f) => [f.id, f.severity])).toEqual([["I11/get", "fatal"]]);
  });

  it("passes a note that names the date asked about and the version served", async () => {
    const r = await asOfIsNeverSilentlySubstituted(session(server((d) => `No version for ${d}; this is the text of 2024-05-01.`)));
    expect(r.findings).toEqual([]);
  });

  it("warns on a note that names neither", async () => {
    const r = await asOfIsNeverSilentlySubstituted(session(server(() => "Some text is shown.")));
    expect(r.findings.every((f) => f.id === "I11/note-generic" && f.severity === "warn")).toBe(true);
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("is not applicable when the library has a version for a date (the reply differs)", async () => {
    const r = await asOfIsNeverSilentlySubstituted(
      session((tool, args) => (tool === "get" && args["as_of"] !== undefined ? { json: { records: [{ ...record, text: "Older text." }] } } : server(() => undefined)(tool, args))),
    );
    expect(r.applicable).toBe(false);
  });
});
