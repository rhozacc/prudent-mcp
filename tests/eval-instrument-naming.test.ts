import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { citationResolutionIsHonest } from "../evals/invariants.ts";

// ── Eval I3: an instrument is the same instrument however it is named ─────────
//
// Run against a real server on a synthetic corpus (it must pass, and bind on the
// probes), and against stand-in sessions that leak in each way the probes exist to
// catch (each must fail, fatally) - an invariant that cannot fail measures nothing.

const dir = mkdtempSync(join(tmpdir(), "prudent-i3n-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const day = "2024-05-01";
const article = (doc: string, framework: string, n: number) => ({
  id: `regulation://${doc}/article-${n}`,
  framework,
  document_id: doc,
  document_version: day,
  citation: `Article ${n}`,
  text: `Synthetic default risk model estimation text of ${doc} number ${n}.`,
});
// A regulation named "crr" and a guideline that numbers its paragraphs the same way.
const corpus = {
  regulation: [10, 11, 12].flatMap((n) => [article("crr", "crr", n), article("gl-a", "acme", n)]),
};

describe("eval I3 on a synthetic corpus", () => {
  it("binds on the numbered-act and identifier probes and finds the server honest", async () => {
    const file = join(dir, "corpus.json");
    writeFileSync(file, JSON.stringify(corpus));
    const session = await openSession({ corpusFile: file });
    try {
      const r = await citationResolutionIsHonest(session);
      expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
      expect(r.applicable).toBe(true);
      const asked = session.traces.filter((t) => t.tool === "resolve_citation").map((t) => String(t.args["text"]));
      for (const probe of [
        "Article 1 of Directive 2099/77/EU",
        "Article 1 of Regulation 2099/933",
        "Article 1 of Decision 2099/12",
        "Article 1 of EBA/GL/2099/04",
      ]) {
        expect(asked).toContain(probe);
      }
    } finally {
      await session.close();
    }
  });
});

/**
 * A session that answers the way a leaky server would. `leaks` names what it gets
 * wrong; everything else it answers as an honest server does: the control probes
 * ("Article N") by whether the corpus has N, anything else by declining.
 */
function leaky(leaks: { numberedShape?: RegExp; identifier?: boolean }): Session {
  const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
    tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
  });
  const declined = (note: string) => ({ match: null, confidence: "none", candidates: [], ambiguous: false, unmatched_segments: [], coverage_note: note });
  const rec = (id: string) => ({ id, citation: "Article 10", document_id: "gl-a" });
  return {
    tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
    async close() {},
    async call(tool, args = {}) {
      if (tool === "get_corpus_info") return trace(tool, args, { coverage: [], holdings: [] });
      if (tool === "search_regulation") {
        return trace(tool, args, { results: [10, 11, 12].map((n) => ({ id: `regulation://crr/article-${n}`, citation: `Article ${n}`, document_id: "crr" })) });
      }
      if (tool !== "resolve_citation") return trace(tool, args, {});
      const text = String(args["text"] ?? "");
      const plain = /^Article (\d+)$/.exec(text)?.[1];
      if (plain !== undefined) {
        return Number(plain) <= 12
          ? trace(tool, args, { match: { id: `regulation://crr/article-${plain}` }, candidates: [] })
          : trace(tool, args, declined(`Nothing in this corpus is numbered ${plain}`));
      }
      if (/EBA\/GL\/|ESMA\//.test(text)) {
        return leaks.identifier === true
          ? trace(tool, args, { match: null, candidates: [rec("regulation://gl-a/article-1")], coverage_note: "container" })
          : trace(tool, args, declined("names a document by the number"));
      }
      if (leaks.numberedShape?.test(text) === true) return trace(tool, args, { match: { id: "regulation://gl-a/article-1" }, candidates: [] });
      return trace(tool, args, declined(`This corpus holds no ${text}; by description`));
    },
  };
}

describe("eval I3 fails a server that leaks", () => {
  it("passes the stand-in that leaks nothing (the stand-in is itself honest)", async () => {
    const r = await citationResolutionIsHonest(leaky({}));
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is fatal when a bare numbered act is sourced from another document", async () => {
    const r = await citationResolutionIsHonest(leaky({ numberedShape: /Directive 2099\/77\/EU|Regulation 2099\/933|Decision 2099\/12/ }));
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.some((f) => f.id === "I3/wrong-instrument")).toBe(true);
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("Directive 2099/77/EU");
  });

  it("is fatal when a document named by an identifier is answered with candidates from others", async () => {
    const r = await citationResolutionIsHonest(leaky({ identifier: true }));
    expect(r.findings.some((f) => f.id === "I3/identifier" && f.severity === "fatal")).toBe(true);
  });
});
