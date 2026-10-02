import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { weakBestMatchIsDeclared } from "../evals/invariants.ts";

// ── Eval I13: a weak best match is declared ────────────────────────────────────
//
// Run against a real server on a synthetic corpus (it must pass and bind), on an
// empty one (nothing to say, so not applicable), and against a stand-in session
// replaying a server that keeps the old envelope (it must fail, fatally) - an
// invariant that cannot fail is not measuring anything. Synthetic throughout.

const dir = mkdtempSync(join(tmpdir(), "prudent-i13-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const day = "2024-05-01";
const corpus = {
  regulation: [
    { id: "regulation://acme/a", framework: "acme", document_id: "acme-reg", document_version: day, citation: "Acme 1", text: "Synthetic default risk text." },
  ],
  checks: [{ id: "check://area/topic", name: "Synthetic", expectation: "Synthetic model data.", last_updated: day }],
  tests: [{ id: "test://acme/t", name: "Synthetic", purpose: "Synthetic validation estimation.", last_updated: day }],
  playbooks: [{ id: "playbook://area/p", area: "Synthetic area", last_updated: day }],
};

async function run(name: string, content: unknown) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(content));
  const session = await openSession({ corpusFile: file });
  try {
    return await weakBestMatchIsDeclared(session);
  } finally {
    await session.close();
  }
}

describe("eval I13 on a synthetic corpus", () => {
  it("binds and passes against a server that declares the weak match", async () => {
    const r = await run("full.json", corpus);
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when the corpus is empty", async () => {
    const r = await run("empty.json", {});
    expect(r.applicable).toBe(false);
    expect(r.findings).toEqual([]);
  });
});

// A session that answers the way the server did before rows exposed coverage.
function stub(envelope: Record<string, unknown>): Session {
  const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
    tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
  });
  return {
    tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
    async close() {},
    async call(tool, args = {}) {
      const query = String(args["query"] ?? "");
      // Only the invented words together match nothing; any common word added matches.
      const matches = /default|risk|model|data|validation|estimation|test|check|area/.test(query);
      // The envelope under test describes the four-term probe; a single-term query
      // (the eval also sends those) is answered with the plain truncation notice.
      const single = !/\s/.test(query.trim());
      return trace(tool, args, matches
        ? { results: [{ id: "x://y/z", name: "n" }], returned: 1, total_matches: 1239, offset: 0, truncated: true, next_offset: 1, ...(single ? { notice: "Showing 1 of 1239 matches." } : envelope) }
        : { results: [], returned: 0, total_matches: 0, offset: 0, truncated: false, next_offset: null });
    },
  };
}

describe("eval I13 on servers that do not declare it", () => {
  it("fails a server that tells a single-term query the topic may not be in the corpus", async () => {
    const session = stub({});
    const inner = session.call.bind(session);
    session.call = async (tool, args = {}) => {
      const t = await inner(tool, args);
      if (/\s/.test(String(args["query"] ?? "").trim()) || t.json === undefined) return t;
      const json = { ...(t.json as object), notice: "The best result matches only 0 of the query's 1 meaningful terms, so the topic may not be in this corpus." };
      return { ...t, json, text: JSON.stringify(json) };
    };
    const r = await weakBestMatchIsDeclared(session);
    expect(r.findings.some((f) => f.evidence.join(" ").includes("single-term query"))).toBe(true);
  });

  it("fails the old envelope: no coverage, no figures, a bare truncation notice", async () => {
    const r = await weakBestMatchIsDeclared(stub({ notice: "Showing 1 of 1239 matches." }));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal").length).toBe(4);
  });

  it("fails a server that overstates how much of the query a hit matched", async () => {
    const r = await weakBestMatchIsDeclared(
      stub({ query_tokens: 4, best_coverage: 3, results: [{ id: "x://y/z", coverage: 3 }], notice: "The topic may not be in this corpus; this is not about the law." }),
    );
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.length).toBe(4);
    expect(fatal[0]!.evidence.join(" ")).toContain("best_coverage is 3");
  });

  it("passes a server that says the right things", async () => {
    const r = await weakBestMatchIsDeclared(
      stub({
        query_tokens: 4,
        best_coverage: 1,
        results: [{ id: "x://y/z", coverage: 1 }],
        notice: "Showing 1 of 1239 matches. The best result matches only 1 of the query's 4 meaningful terms, so the topic may not be in this corpus. Absence of a strong match is a statement about the corpus, not about the law.",
      }),
    );
    expect(r.findings).toEqual([]);
  });
});
