import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { asOfIsNeverSilentlySubstituted } from "../evals/invariants.ts";

// ── Eval I11 does not fail a corpus that records its versions properly ─────────
//
// I11 binds on a record with no recorded history. From outside, a record whose
// ONLY history entry is the current text (the current-boundary entry the corpus
// format asks for), effective before the first probe date, answers every probe
// identically and — correctly — without a note, so reply equality alone cannot
// tell it from an unrecorded provision. The harness therefore reads which ids the
// corpus file names in `regulation_history` and skips them. Synthetic corpus.

const dir = mkdtempSync(join(tmpdir(), "prudent-i11-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const rec = (n: number) => ({
  id: `regulation://acme/art-${n}`,
  framework: "acme",
  document_id: "acme-reg",
  document_version: "2024-05-01",
  citation: `Acme Article ${n}`,
  text: `Synthetic article ${n}: default risk model validation data estimation.`,
});
const records = [1, 2, 3, 4].map(rec);
const sources = [
  {
    id: "source://acme/acme-reg",
    title: "Acme regulation",
    framework: "acme",
    document_id: "acme-reg",
    doc_type: "regulation",
    status: "current",
    published: "2010-01-01",
    verified: new Date().toISOString().slice(0, 10),
  },
];

function write(name: string, regulation_history: unknown[]): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify({ regulation: records, sources, regulation_history }));
  return file;
}

async function runI11(file: string) {
  const session = await openSession({ corpusFile: file });
  try {
    return await asOfIsNeverSilentlySubstituted(session);
  } finally {
    await session.close();
  }
}

describe("eval I11 on a synthetic corpus", () => {
  it("binds on records with no history, and finds the server flags them", async () => {
    const r = await runI11(write("no-history.json", []));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("does not fail records whose only history is a current-boundary entry before the first probe date", async () => {
    const history = records.map((record) => ({ id: record.id, effective_from: "2012-01-01", record }));
    const r = await runI11(write("boundary-history.json", history));
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    // Every sampled record is recorded, so there is nothing for I11 to bind on.
    expect(r.applicable).toBe(false);
  });

  it("still binds on the records the file does not name", async () => {
    const [first, ...rest] = records;
    const history = [{ id: first!.id, effective_from: "2012-01-01", record: first }];
    const r = await runI11(write("partial-history.json", history));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    expect(rest.length).toBe(3);
  });
});

// ── Eval I11 and a child the corpus holds but has no version of ───────────────
//
// A parent can be fully recorded while one child is not: the child's document was
// published after the probe date, or its history starts later. It comes back as a
// bare id, so the reply has to say it is a gap. Run against the real server on a
// synthetic corpus (must pass, and bind), and against a stand-in session replaying
// a server that says nothing (must fail, fatally).

describe("eval I11 on a child with no version for the date", () => {
  const parent = { ...rec(1), children: ["regulation://later/p-1"] };
  const child = {
    id: "regulation://later/p-1",
    framework: "later",
    document_id: "later-doc",
    document_version: "2020-01-01",
    citation: "Later paragraph 1",
    text: "Synthetic paragraph of a document published later: default risk model validation.",
    parent: parent.id,
  };
  const laterSource = { ...sources[0], id: "source://later/later-doc", framework: "later", document_id: "later-doc", published: "2020-01-01" };

  it("binds on it and finds the server says so", async () => {
    const file = join(dir, "later-child.json");
    writeFileSync(
      file,
      JSON.stringify({
        regulation: [parent, child],
        sources: [sources[0], laterSource],
        // The parent is fully recorded: a boundary entry before every probe date.
        regulation_history: [{ id: parent.id, effective_from: "2012-01-01", record: parent }],
      }),
    );
    const session = await openSession({ corpusFile: file });
    try {
      const r = await asOfIsNeverSilentlySubstituted(session);
      expect(r.applicable).toBe(true);
      expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
      // The probe really embedded the child with no record, so the pass is not vacuous.
      const expanded = session.traces.find(
        (t) => t.tool === "expand_regulation" && t.args["id"] === parent.id && t.args["as_of"] === "2014-06-30" && t.args["detail"] === "full",
      );
      const kids = ((expanded?.json as { children?: Array<{ record: unknown }> } | null)?.children ?? []) as Array<{ record: unknown }>;
      expect(kids.map((k) => k.record)).toEqual([null]);
      expect(typeof (expanded?.json as { as_of_note?: unknown } | null)?.as_of_note).toBe("string");
    } finally {
      await session.close();
    }
  });

  // A session that answers the way the server did before the gap was counted.
  function silentServer(note: string | undefined): Session {
    const trace = (tool: string, args: Record<string, unknown>, json: unknown, isError = false): CallTrace => ({
      tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError, json,
    });
    const record = { id: parent.id, document_version: "2024-05-01", text: "Synthetic." };
    return {
      tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
      async close() {},
      async call(tool, args = {}) {
        const asOf = typeof args["as_of"] === "string" ? args["as_of"] : undefined;
        if (tool === "search_regulation") return trace(tool, args, { results: [{ id: parent.id, document_id: "acme-reg" }] });
        if (tool === "get_regulation") {
          if (args["id"] === child.id) return trace(tool, args, asOf === undefined ? { ...child } : { error: "no version" }, asOf !== undefined);
          // Current text under a date, with the substitution note the other half of I11 wants.
          return trace(tool, args, asOf === undefined ? record : { as_of_note: `as_of ${asOf} 2024-05-01`, ...record });
        }
        if (tool === "expand_regulation") {
          const base = { id: parent.id, children: [{ type: "regulation", id: child.id, record: null }] };
          // The concise form is the substitution cross-check; only the full form embeds the child.
          if (args["detail"] !== "full") return trace(tool, args, { as_of_note: `as_of ${asOf}`, ...base });
          return trace(tool, args, note === undefined ? base : { as_of_note: note.replace("DATE", String(asOf)), ...base });
        }
        if (tool === "get_regulation_tree") return trace(tool, args, { as_of_note: `as_of ${asOf}`, id: parent.id, children: [] });
        return trace(tool, args, {});
      },
    };
  }

  it("fails a server that embeds the child as a bare id and says nothing", async () => {
    const r = await asOfIsNeverSilentlySubstituted(silentServer(undefined));
    const gap = r.findings.filter((f) => f.id === "I11/expand_regulation-gap");
    expect(gap.length).toBeGreaterThan(0);
    expect(gap.every((f) => f.severity === "fatal")).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal" && f.id !== "I11/expand_regulation-gap")).toEqual([]);
  });

  it("fails a note that names no date", async () => {
    const r = await asOfIsNeverSilentlySubstituted(silentServer("Something is missing."));
    expect(r.findings.some((f) => f.id === "I11/expand_regulation-gap")).toBe(true);
  });

  it("passes a server whose note names the date", async () => {
    const r = await asOfIsNeverSilentlySubstituted(silentServer("1 child has no recorded version for the requested as_of date (DATE)."));
    expect(r.findings.filter((f) => f.id === "I11/expand_regulation-gap")).toEqual([]);
  });
});
