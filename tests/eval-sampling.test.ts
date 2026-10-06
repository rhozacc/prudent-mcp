import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession } from "../evals/harness.ts";
import { asOfIsNeverSilentlySubstituted, selfRetrievalIsAffordable } from "../evals/invariants.ts";

// ── Two invariants must not let the ranking decide whether they bind ───────────
//
// Both sample records from the server's own search output, so a change of
// ranking changed what they measured. I11 took the FIRST eight candidate ids:
// when the top results were all of documents newer than its earliest probe date
// (answered by a miss, so skipped as having history) it tested nothing and went
// quietly inapplicable. I8 built each probe query from five words out of the
// middle of a record's vocabulary, which on a real corpus meant boilerplate
// ("article regulation apply following") that no ranker can be asked to resolve
// to one record. Synthetic corpora.

const dir = mkdtempSync(join(tmpdir(), "prudent-sampling-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const today = new Date().toISOString().slice(0, 10);
const source = (document_id: string, published: string) => ({
  id: `source://acme/${document_id}`,
  title: document_id,
  framework: "acme",
  document_id,
  doc_type: "regulation",
  status: "current",
  published,
  verified: today,
});

function write(name: string, body: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

describe("I11 probes until it has tested enough, not only the first candidates", () => {
  it("binds when the top-ranked records are all of documents too new for the probe dates", async () => {
    // Five documents of two provisions each, published in 2025, head every seed search (two ids each are
    // kept, so ten candidates), and none of them existed in 2014 or 2019: every
    // probe of them comes back differently, and they are skipped as having history.
    // The old document ranks only for the last seed ("validation"), so it is the
    // eleventh candidate on: the first eight tell I11 nothing, and it must go on.
    const seedWords = "default estimation risk data model";
    const youngDocs = ["a", "b", "c", "d", "e"];
    const young = youngDocs.flatMap((d) =>
      [0, 1].map((i) => ({
        id: `regulation://acme/young-${d}-${i}`,
        framework: "acme",
        document_id: `young-${d}`,
        document_version: "2025-01-01",
        citation: `Young ${d} Article ${i}`,
        text: `${seedWords} ${seedWords} ${seedWords} young ${d} article ${i}.`,
      })),
    );
    const old = [1, 2].map((i) => ({
      id: `regulation://acme/old-${i}`,
      framework: "acme",
      document_id: "old-reg",
      document_version: "2013-01-01",
      citation: `Old Article ${i}`,
      text: `Old article ${i}: validation validation validation validation.`,
    }));
    const file = write("young-first.json", {
      regulation: [...young, ...old],
      sources: [...youngDocs.map((d) => source(`young-${d}`, "2025-01-01")), source("old-reg", "2010-01-01")],
    });
    const session = await openSession({ corpusFile: file });
    try {
      const r = await asOfIsNeverSilentlySubstituted(session);
      expect(r.applicable).toBe(true);
      expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

describe("I8 builds its queries from words that are rare in the corpus", () => {
  it("does not ask the ranker to resolve boilerplate to one record", async () => {
    // Forty provisions share twelve boilerplate words, set between two words of
    // their own at each end. Five words from the middle of the vocabulary are then
    // all boilerplate, which every record carries equally: no ranker can place one
    // of forty equal records in the top ten, and none should be asked to.
    // Words of a record's own are letters only, as the probe reads words: "quantile7" would be
    // "quantile" to it, and "quantile" is in all forty.
    const code = (i: number): string => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    const boilerplate =
      "article regulation apply following shall competent authorities provision requirement obligation paragraph subject";
    // The last ten also say the seed words most, so they are the ones I8 samples; being
    // late in input order they cannot be found by an equal-score tie falling their way.
    const records = Array.from({ length: 40 }, (_, i) => ({
      id: `regulation://acme/art-${i}`,
      framework: "acme",
      document_id: "acme-reg",
      document_version: "2024-05-01",
      citation: `Acme Article ${i}`,
      text:
        `quantile${code(i)} heteroscedastic${code(i)} ${boilerplate} winsorised${code(i)} bootstrap${code(i)}.` +
        (i >= 30 ? " Requirements estimation estimation data data." : ""),
    }));
    const file = write("boilerplate.json", { regulation: records, sources: [source("acme-reg", "2010-01-01")] });
    const session = await openSession({ corpusFile: file });
    try {
      const r = await selfRetrievalIsAffordable(session);
      expect(r.applicable).toBe(true);
      expect(r.findings.filter((f) => f.id === "I8/unfindable")).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
