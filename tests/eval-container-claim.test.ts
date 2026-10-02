import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { containerClaimsAreTrue } from "../evals/invariants.ts";

// ── Eval I3/container-claim ───────────────────────────────────────────────────
//
// Any note saying the containing record carries a point must be true of the text
// the server serves for it. Run against real sessions on synthetic corpora (the
// server is honest, so nothing fires) and against a scripted session that makes
// the false claim (so the eval can be seen to fire).

const dir = mkdtempSync(join(tmpdir(), "prudent-i3c-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rec = (n: number, text: string) => ({
  id: `regulation://acme/article-${n}`,
  framework: "acme",
  document_id: "acme-act",
  document_version: "2024-05-01",
  citation: `Acme Article ${n}`,
  text,
});

/** Lettered points under paragraph 2 only. */
const LETTERED = [
  "1. Synthetic default risk opening.",
  "2. Synthetic default risk list:\n(a) first;\n(b) second.",
  "3. Synthetic default risk closing.",
].join("\n");

const SEVEN = Array.from({ length: 7 }, (_, i) => `${i + 1}. Synthetic default risk paragraph ${i + 1}.`).join("\n");

function write(name: string, regulation: unknown[]): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ regulation }));
  return file;
}

async function run(file: string) {
  const session = await openSession({ corpusFile: file });
  try {
    return await containerClaimsAreTrue(session);
  } finally {
    await session.close();
  }
}

describe("eval I3/container-claim", () => {
  it("binds on a corpus whose articles contain deeper citations, and finds the server honest", async () => {
    const r = await run(write("articles.json", [rec(180, SEVEN), rec(181, SEVEN)]));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("finds the server honest on nested points, where (b) exists under one paragraph only", async () => {
    const r = await run(write("nested.json", [rec(180, LETTERED), rec(181, LETTERED)]));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when no citation reaches the containing-provision rule", async () => {
    // Records with no numbered citation to deepen: nothing can sit inside them.
    const unnumbered = { ...rec(1, "Synthetic default risk text."), citation: "Preamble" };
    const r = await run(write("none.json", [unnumbered]));
    expect(r.applicable).toBe(false);
    expect(r.findings.every((f) => f.severity !== "fatal")).toBe(true);
  });
});

/** A session that answers like a server which still claims without looking. */
function scripted(claimText: string, claim = "9", unmatched = ["180", "9"]): Session {
  const trace = (tool: string, json: unknown): CallTrace => ({
    tool,
    args: {},
    text: JSON.stringify(json),
    chars: 0,
    tokens: 0,
    ms: 0,
    isError: false,
    json,
  });
  return {
    tools: [],
    surfaceTokens: 0,
    wireTokens: 0,
    instructions: "",
    traces: [],
    close: async () => {},
    call: async (tool) => {
      if (tool === "search_regulation") {
        return trace(tool, { results: [{ citation: "Acme Article 180" }] });
      }
      if (tool === "get_regulation") {
        return trace(tool, { id: "regulation://acme/article-180", text: claimText });
      }
      return trace(tool, {
        match: null,
        confidence: "none",
        unmatched_segments: unmatched,
        candidates: [{ id: "regulation://acme/article-180" }],
        coverage_note:
          'It holds the provision containing it: "Acme Article 180" (regulation://acme/article-180), ' +
          `whose text carries point ${claim}. Open it.`,
      });
    },
  };
}

describe("eval I3/container-claim fires on a false claim", () => {
  it("is fatal when the served text has no such point", async () => {
    const r = await containerClaimsAreTrue(scripted("1. One.\n2. Two.\n3. Three."));
    expect(r.applicable).toBe(true);
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal[0]?.id).toBe("I3/container-claim");
  });

  it("is fatal when a nested claim names a limb that exists only under another paragraph", async () => {
    // (b) is under paragraph 2; the claim is 3.b, and the note says "3.b. Open it".
    const r = await containerClaimsAreTrue(scripted(LETTERED, "3.b", ["180", "3", "b"]));
    expect(r.applicable).toBe(true);
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal[0]?.evidence.join(" ")).toContain("point 3.b");
  });

  it("passes when a nested claim is true", async () => {
    const r = await containerClaimsAreTrue(scripted(LETTERED, "2.b", ["180", "2", "b"]));
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("passes when the served text does carry it", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `${i + 1}. Synthetic paragraph ${i + 1}.`).join("\n");
    const r = await containerClaimsAreTrue(scripted(nine));
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });
});
