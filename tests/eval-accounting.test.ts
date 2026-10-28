import { describe, expect, it } from "bun:test";

import { runInvariants, type CallTrace, type InvariantResult, type Session } from "../evals/harness.ts";

// The suite's totals keep their meaning; each invariant also reports what ITS probes cost, so a new probe is not a
// regression in the others.

function session(): Session {
  const traces: CallTrace[] = [];
  return {
    tools: [],
    surfaceTokens: 0,
    wireTokens: 0,
    instructions: "",
    traces,
    async close() {},
    async call(tool, args = {}): Promise<CallTrace> {
      const t: CallTrace = { tool, args, text: "x", chars: 1, tokens: 10, ms: 0, isError: false, json: null };
      traces.push(t);
      return t;
    },
  };
}

const result = (id: string): InvariantResult => ({ id, title: id, applicable: true, findings: [] });

describe("runInvariants accounting", () => {
  it("charges each invariant for the traces its own probes added, and they sum to the totals", async () => {
    const s = session();
    const { results, costs } = await runInvariants(s, [
      async (x) => (await x.call("get"), await x.call("search"), result("A")),
      async (x) => (await x.call("get"), result("B")),
      async (x) => (x.traces.length, result("C")), // reads earlier traces, makes none
    ]);
    expect(results.map((r) => r.id)).toEqual(["A", "B", "C"]);
    expect(costs).toEqual([
      { id: "A", calls: 2, tokens_observed: 20 },
      { id: "B", calls: 1, tokens_observed: 10 },
      { id: "C", calls: 0, tokens_observed: 0 },
    ]);
    expect(costs.reduce((n, c) => n + c.calls, 0)).toBe(s.traces.length);
    expect(costs.reduce((n, c) => n + c.tokens_observed, 0)).toBe(s.traces.reduce((n, t) => n + t.tokens, 0));
  });
});
