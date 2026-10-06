import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { citationResolutionIsHonest, titledCitationsResolve } from "../evals/invariants.ts";

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
// A regulation named "crr" and a guideline that numbers its paragraphs the same way,
// each with a registry entry that gives it a title.
const source = (doc: string, framework: string, title: string) => ({
  id: `source://${framework}/${doc}`,
  title,
  framework,
  document_id: doc,
  doc_type: "guideline",
  status: "current",
  verified: day,
  milestones: [],
});
const corpus = {
  regulation: [10, 11, 12].flatMap((n) => [article("crr", "crr", n), article("gl-a", "acme", n)]),
  sources: [
    source("crr", "crr", "Regulation (EU) No 575/2013 (CRR) \u2014 synthetic edition"),
    source("gl-a", "acme", "Acme guidelines on the estimation of alpha under the synthetic regulation"),
  ],
};

describe("eval I3 on a synthetic corpus", () => {
  it("binds on the numbered-act, identifier, same-instrument and title probes and finds the server honest", async () => {
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
        "Article 1 of 2099/77/EU Directive",
        "Article 1 of 2099/933 Regulation",
        "Article 12 of 575/2013 Directive",
        "Article 1 of EBA/GL/2099/04",
      ]) {
        expect(asked).toContain(probe);
      }
      expect(asked.some((t) => /of the Capital Requirements Regulation$/.test(t))).toBe(true);
      // The title probe asks for a record of a document by the registry's title.
      expect(asked.some((t) => t.includes("Acme guidelines on the estimation of alpha"))).toBe(true);
    } finally {
      await session.close();
    }
  });
});

/**
 * A session that answers the way a leaky server would. `leaks` names what it gets
 * wrong; everything else it answers as an honest server does: the control probes
 * ("Article N") by whether the corpus has N (two documents do, so several records
 * fit), a title or the CRR by its own document, anything else by declining.
 */
function leaky(leaks: { numberedShape?: RegExp; identifier?: boolean; englishName?: boolean; title?: boolean; kindMismatch?: boolean }): Session {
  const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
    tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
  });
  const declined = (note: string) => ({ match: null, confidence: "none", candidates: [], ambiguous: false, unmatched_segments: [], coverage_note: note });
  const rec = (id: string) => ({ id, citation: "Article 10", document_id: "gl-a" });
  return {
    tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
    async close() {},
    async call(tool, args = {}) {
      if (tool === "get_corpus_info") {
        return trace(tool, args, { coverage: [], holdings: [{ document_id: "gl-a", framework: "acme", title: "Acme guidelines on alpha estimation", records: 3 }] });
      }
      if (tool === "search_regulation") {
        return trace(tool, args, {
          results: [10, 11, 12].flatMap((n) => [
            { id: `regulation://crr/article-${n}`, citation: `Article ${n}`, document_id: "crr" },
            { id: `regulation://gl-a/article-${n}`, citation: `Article ${n}`, document_id: "gl-a" },
          ]),
        });
      }
      if (tool !== "resolve_citation") return trace(tool, args, {});
      const text = String(args["text"] ?? "");
      // A title names its document: the honest answer is that document's record.
      const titled = /^Article (\d+) of Acme guidelines on alpha estimation|^Acme guidelines on alpha estimation, Article (\d+)$/.exec(text);
      if (titled !== null) {
        const n = titled[1] ?? titled[2];
        return leaks.title === true
          ? trace(tool, args, { match: { id: `regulation://crr/article-${n}` }, candidates: [] })
          : trace(tool, args, { match: { id: `regulation://gl-a/article-${n}` }, candidates: [] });
      }
      // Two documents share the number: the honest answer is that several records fit.
      const plain = /^Article (\d+)$/.exec(text)?.[1];
      if (plain !== undefined) {
        return Number(plain) <= 12
          ? trace(tool, args, {
              match: null,
              confidence: "none",
              ambiguous: true,
              candidates: [`regulation://crr/article-${plain}`, `regulation://gl-a/article-${plain}`].map((id) => ({ id, citation: `Article ${plain}`, document_id: id.split("/")[2] })),
            })
          : trace(tool, args, declined(`Nothing in this library is numbered ${plain}`));
      }
      // A held number with the word of another kind of act names another act: no directive
      // or decision is numbered 575/2013, so the regulation that carries it is not the answer.
      if (/575\/2013\s+(?:Directive|Decision)|(?:Directive|Decision)\s+575\/2013/i.test(text)) {
        const n = /Article (\d+)/.exec(text)?.[1];
        return leaks.kindMismatch === true && n !== undefined && Number(n) <= 12
          ? trace(tool, args, { match: { id: `regulation://crr/article-${n}` }, candidates: [] })
          : trace(tool, args, declined("This library holds no Directive 2013/575"));
      }
      // The CRR is held: its own articles resolve in every spelling, unless leaking.
      if (/\bCRR\b|Capital Requirements Regulation|575\/2013/.test(text)) {
        const n = /Article (\d+)/.exec(text)?.[1];
        if (leaks.englishName === true && /Capital Requirements Regulation/.test(text)) {
          return trace(tool, args, { match: rec(`regulation://gl-a/article-${n}`), candidates: [] });
        }
        return n !== undefined && Number(n) <= 12
          ? trace(tool, args, { match: { id: `regulation://crr/article-${n}` }, candidates: [] })
          : trace(tool, args, declined("Nothing in this library is numbered " + n));
      }
      if (/EBA\/GL\/|ESMA\//.test(text)) {
        return leaks.identifier === true
          ? trace(tool, args, { match: null, candidates: [rec("regulation://gl-a/article-1")], coverage_note: "container" })
          : trace(tool, args, declined("names a document by the number"));
      }
      if (leaks.numberedShape?.test(text) === true) return trace(tool, args, { match: { id: "regulation://gl-a/article-1" }, candidates: [] });
      return trace(tool, args, declined(`This library holds no ${text}; by description`));
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

  it("is fatal when a number written first is sourced from another document", async () => {
    const r = await citationResolutionIsHonest(leaky({ numberedShape: /2099\/\d+(?:\/EU)? (?:Directive|Regulation|Decision)/ }));
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.some((f) => f.id === "I3/wrong-instrument")).toBe(true);
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("2099/77/EU Directive");
  });

  it("is fatal when a held number with the word of another kind of act is answered out of the held instrument", async () => {
    const r = await citationResolutionIsHonest(leaky({ kindMismatch: true }));
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.some((f) => f.id === "I3/wrong-instrument")).toBe(true);
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("575/2013");
  });

  it("is fatal when a document named by an identifier is answered with candidates from others", async () => {
    const r = await citationResolutionIsHonest(leaky({ identifier: true }));
    expect(r.findings.some((f) => f.id === "I3/identifier" && f.severity === "fatal")).toBe(true);
  });

  it("is fatal when the English name is resolved into a different document than the short name", async () => {
    const r = await citationResolutionIsHonest(leaky({ englishName: true }));
    const fatal = r.findings.filter((f) => f.id === "I3/same-instrument-same-answer");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal[0]?.severity).toBe("fatal");
    expect(fatal[0]?.evidence.join(" ")).toContain("Capital Requirements Regulation");
  });

  it("is fatal when a document named by its registry title is answered out of another document", async () => {
    const r = await citationResolutionIsHonest(leaky({ title: true }));
    const fatal = r.findings.filter((f) => f.id === "I3/titled-citation");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal[0]?.severity).toBe("fatal");
    expect(fatal[0]?.evidence.join(" ")).toContain("Acme guidelines on alpha estimation");
  });

  it("is not applicable to the title probe when no document has a title", async () => {
    const session = leaky({});
    const original = session.call.bind(session);
    session.call = async (tool, args = {}) => (tool === "get_corpus_info" ? original(tool, args).then((t) => ({ ...t, text: JSON.stringify({ holdings: [] }), json: { holdings: [] } })) : original(tool, args));
    const r = await titledCitationsResolve(session);
    expect(r.applicable).toBe(false);
  });
});
