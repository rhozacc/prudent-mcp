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

