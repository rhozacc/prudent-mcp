import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openSession } from "../evals/harness.ts";
import { declineOnPartialDocumentSaysSo } from "../evals/invariants.ts";
import { adapters } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters, resolveCitationDetailed } from "../src/file-adapter.ts";
import {
  computeHoldings,
  holdingForId,
  holdingsSummary,
  holdingsWarnings,
  idDocSegment,
  missingRecordClause,
} from "../src/holdings.ts";
import { CorpusInfoSchema, SourceSchema } from "../src/schema.ts";
import { createServer } from "../src/server.ts";
import { corpusWarnings } from "../src/validate.ts";

// ── What the corpus holds of each document ──────────────────────────────────────
//
// `coverage: ["CRR"]` reads as the whole regulation, and "No record for ..." reads
// as "there is no such article"; both are true of the corpus and neither says
// anything about the law. Everything here is a synthetic corpus: four documents
// that are partial, full, undeclared and multi-source, none of them real.

const rec = (id: string, framework: string, document_id: string, citation: string, extra: Record<string, unknown> = {}) => ({
  id,
  framework,
  document_id,
  document_version: "2024-01-01",
  citation,
  text: `Synthetic text of ${citation}.`,
  ...extra,
});

const source = (framework: string, document_id: string, extra: Record<string, unknown> = {}) => ({
  id: `source://${framework}/${document_id}-${String(extra["status"] ?? "current")}-${String(extra["coverage"] ?? "none")}`,
  title: `Title of ${document_id}`,
  framework,
  document_id,
  doc_type: "regulation",
  status: "current",
  verified: new Date().toISOString().slice(0, 10),
  ...extra,
});

const regulation = [
  // alpha: declared partial. Article 3 itself is absent but 3(a) and 3(b) are held.
  rec("regulation://alpha/art-1", "al", "alpha-doc", "Alpha Article 1"),
  rec("regulation://alpha/art-2", "al", "alpha-doc", "Alpha Article 2"),
  rec("regulation://alpha/art-3-a", "al", "alpha-doc", "Alpha Article 3(a)"),
  rec("regulation://alpha/art-3-b", "al", "alpha-doc", "Alpha Article 3(b)"),
  // beta: declared full.
  rec("regulation://beta/art-1", "be", "beta-doc", "Beta Article 1"),
  // gamma: held, registry silent. Its id segment is not its document_id.
  rec("regulation://gam-seg/art-1", "ga", "gamma-doc", "Gamma Article 1"),
  rec("regulation://gam-seg/art-2", "ga", "gamma-doc", "Gamma Article 2"),
  // delta: two current sources whose declarations conflict, plus an old edition.
  rec("regulation://delta/art-1", "de", "delta-doc", "Delta Article 1"),
  // epsilon: current says full; a superseded edition said partial.
  rec("regulation://epsilon/art-1", "ep", "epsilon-doc", "Epsilon Article 1"),
];

const sources = [
  source("al", "alpha-doc", { coverage: "partial" }),
  source("be", "beta-doc", { coverage: "full" }),
  source("ga", "gamma-doc"),
  source("de", "delta-doc", { coverage: "full" }),
  source("de", "delta-doc", { coverage: "partial" }),
  source("de", "delta-doc", { status: "superseded", coverage: "full", superseded_by: "source://de/delta-doc-current-full" }),
  source("ep", "epsilon-doc", { coverage: "full" }),
  source("ep", "epsilon-doc", { status: "superseded", coverage: "partial", superseded_by: "source://ep/epsilon-doc-current-full" }),
];

const parsed = CorpusFileSchema.parse({ regulation, sources });
const holdingOf = (document_id: string) => computeHoldings(parsed.regulation, parsed.sources).find((h) => h.document_id === document_id);

// ── computeHoldings ─────────────────────────────────────────────────────────────

describe("computeHoldings", () => {
  it("counts regulation records per document, in order of first appearance", () => {
    const h = computeHoldings(parsed.regulation, parsed.sources);
    expect(h.map((x) => [x.document_id, x.records])).toEqual([
      ["alpha-doc", 4],
      ["beta-doc", 1],
      ["gamma-doc", 2],
      ["delta-doc", 1],
      ["epsilon-doc", 1],
    ]);
  });

  it("partial is true / false as the current source declares, and the KEY IS ABSENT when it does not", () => {
    expect(holdingOf("alpha-doc")?.partial).toBe(true);
    expect(holdingOf("beta-doc")?.partial).toBe(false);
    const gamma = holdingOf("gamma-doc");
    expect(gamma).toBeDefined();
    expect("partial" in (gamma ?? {})).toBe(false);
  });

  it("several current sources that disagree: partial wins", () => {
    expect(holdingOf("delta-doc")?.partial).toBe(true);
  });

  it("a superseded source does not speak for the document", () => {
    expect(holdingOf("epsilon-doc")?.partial).toBe(false);
  });

  it("title comes from the matching source; framework and document_id are carried", () => {
    expect(holdingOf("alpha-doc")).toMatchObject({ framework: "al", title: "Title of alpha-doc", records: 4 });
  });

  it("a document with no source has no title key, and no declaration", () => {
    const h = computeHoldings([rec("regulation://orphan/a", "or", "orphan-doc", "Orphan A")].map((r) => CorpusFileSchema.parse({ regulation: [r] }).regulation[0]!), []);
    expect(h).toEqual([{ document_id: "orphan-doc", framework: "or", records: 1 }]);
  });

  it("a source whose framework differs does not match on document_id alone", () => {
    const h = computeHoldings(parsed.regulation, [SourceSchema.parse(source("zz", "alpha-doc", { coverage: "partial" }))]);
    expect(h.find((x) => x.document_id === "alpha-doc")).not.toHaveProperty("partial");
  });

  it("an empty corpus holds nothing", () => {
    expect(computeHoldings([], parsed.sources)).toEqual([]);
  });

  it("holdingsSummary names the declaration state of each document", () => {
    const line = holdingsSummary(computeHoldings(parsed.regulation, parsed.sources));
    expect(line).toContain("alpha-doc 4 (partial)");
    expect(line).toContain("beta-doc 1 (full)");
    expect(line).toContain("gamma-doc 2 (undeclared)");
  });
});

describe("holdingForId", () => {
  const h = computeHoldings(parsed.regulation, parsed.sources);
  it("finds the document by the id's first path segment, which need not be its document_id", () => {
    expect(idDocSegment("regulation://gam-seg/art-9")).toBe("gam-seg");
    expect(holdingForId(parsed.regulation, h, "regulation://gam-seg/art-9")?.document_id).toBe("gamma-doc");
  });
  it("falls back to a segment that spells a held document_id", () => {
    expect(holdingForId(parsed.regulation, h, "regulation://beta-doc/x")?.document_id).toBe("beta-doc");
  });
  it("null when no held document answers to the prefix", () => {
    expect(holdingForId(parsed.regulation, h, "regulation://nowhere/x")).toBeNull();
  });
});

// ── the schema ──────────────────────────────────────────────────────────────────

describe("schema", () => {
  it("Source.coverage is optional and is never defaulted", () => {
    const s = SourceSchema.parse(source("al", "alpha-doc"));
    expect("coverage" in s).toBe(false);
    expect(() => SourceSchema.parse(source("al", "alpha-doc", { coverage: "most" }))).toThrow();
  });

  it("a stored corpus_info without holdings still parses, and holdings stays absent", () => {
    const info = CorpusInfoSchema.parse({ last_updated: "2026-01-01T00:00:00Z", counts: {}, coverage: ["AL"] });
    expect("holdings" in info).toBe(false);
  });
});

// ── meta.info ───────────────────────────────────────────────────────────────────

describe("meta.info() holdings", () => {
  it("is computed from the records and the registry", async () => {
    const info = await createFileAdapters(parsed).meta.info();
    expect(info.holdings?.find((h) => h.document_id === "alpha-doc")).toMatchObject({ records: 4, partial: true });
    expect(info.coverage).toEqual(["AL", "BE", "GA", "DE", "EP"]);
  });

  it("is computed at serve time even when the file ships a stored corpus_info block", async () => {
    const stored = CorpusFileSchema.parse({
      regulation,
      sources,
      corpus_info: {
        last_updated: "2020-01-01T00:00:00Z",
        counts: { regulation: 1, test: 0, check: 0, playbook: 0, source: 0 },
        coverage: ["STORED-ONLY"],
      },
    });
    const info = await createFileAdapters(stored).meta.info();
    expect(info.coverage).toEqual(["STORED-ONLY"]); // the authored list is untouched
    expect(info.holdings?.map((h) => h.document_id)).toEqual(["alpha-doc", "beta-doc", "gamma-doc", "delta-doc", "epsilon-doc"]);
    expect(info.holdings?.find((h) => h.document_id === "alpha-doc")?.partial).toBe(true);
  });
});

// ── the miss, on all three tools ─────────────────────────────────────────────────

describe("an unknown regulation id", () => {
  let saved: typeof adapters;
  let client: Client;

  beforeEach(async () => {
    saved = { ...adapters };
    Object.assign(adapters, createFileAdapters(parsed));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "holdings-test", version: "0.0.0" });
    await client.connect(clientTransport);
    await client.listTools();
  });
  afterEach(async () => {
    Object.assign(adapters, saved);
    await client.close();
  });

  const text = (r: unknown): string => {
    const content = (r as { content?: Array<{ text?: string }> }).content ?? [];
    return content.map((c) => c.text ?? "").join("");
  };
  const TOOLS = ["get_regulation", "expand_regulation", "get_regulation_tree"] as const;

  const variants: Array<[string, string, RegExp, RegExp]> = [
    ["partial", "regulation://alpha/art-99", /holds only part of Title of alpha-doc \(4 records\).*absent from the corpus, not necessarily from the law/s, /probably mistyped/],
    ["undeclared", "regulation://gam-seg/art-99", /holds 2 records of Title of gamma-doc and does not declare that as the whole.*absence here does not show the provision does not exist/s, /holds only part|probably mistyped/],
    ["declared full", "regulation://beta/art-99", /declares Title of beta-doc held in full \(1 record\).*probably mistyped/s, /holds only part|does not declare/],
    ["not held", "regulation://nowhere/art-1", /No document with the id prefix "nowhere" is loaded.*get_corpus_info/s, /holds only part|probably mistyped|does not declare/],
  ];

  for (const tool of TOOLS) {
    for (const [name, id, wants, unwanted] of variants) {
      it(`${tool}: ${name} document`, async () => {
        const r = await client.callTool({ name: tool, arguments: { id } });
        expect(r.isError).toBe(true);
        const t = text(r);
        expect(t).toContain(`No record for ${id}.`);
        expect(t).toMatch(wants);
        expect(t).not.toMatch(unwanted);
        // The pre-existing pointer survives every variant.
        expect(t).toContain("Verify the id with search_regulation or list_review_areas.");
      });
    }
  }

  it("a conflicting-declaration document is treated as partial", async () => {
    const r = await client.callTool({ name: "get_regulation", arguments: { id: "regulation://delta/art-9" } });
    expect(text(r)).toMatch(/holds only part of Title of delta-doc/);
  });

  it("get_corpus_info publishes holdings and the stored coverage list side by side", async () => {
    const r = await client.callTool({ name: "get_corpus_info", arguments: {} });
    const body = r.structuredContent as { coverage: string[]; holdings: Array<{ document_id: string; partial?: boolean }> };
    expect(body.coverage).toContain("AL");
    const gamma = body.holdings.find((h) => h.document_id === "gamma-doc");
    expect(gamma).toBeDefined();
    expect("partial" in (gamma ?? {})).toBe(false);
    expect(body.holdings.find((h) => h.document_id === "beta-doc")?.partial).toBe(false);
  });
});

// ── resolve_citation ────────────────────────────────────────────────────────────

describe("resolveCitationDetailed notes", () => {
  const holdings = computeHoldings(parsed.regulation, parsed.sources);
  const resolve = (text: string, withHoldings = true) =>
    withHoldings ? resolveCitationDetailed(parsed.regulation, text, holdings) : resolveCitationDetailed(parsed.regulation, text);

  it("nothing numbered, document named and partial: says so, still a decline", () => {
    const r = resolve("Alpha Article 99");
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("none");
    expect(r.coverage_note).toContain("Nothing in this corpus is numbered 99 in the document named.");
    expect(r.coverage_note).toMatch(/holds only part of Title of alpha-doc \(4 records\).*not necessarily from the law/s);
  });

  it("nothing numbered, document named and declared full or undeclared: no partial clause", () => {
    expect(resolve("Beta Article 99").coverage_note).not.toMatch(/only part/);
    expect(resolve("Gamma-doc Article 99").coverage_note).not.toMatch(/only part/);
  });

  it("nothing numbered, no document named: names every partial document held", () => {
    const note = resolve("Article 99").coverage_note ?? "";
    expect(note).toContain("Nothing in this corpus is numbered 99.");
    expect(note).toMatch(/holds only part of Title of alpha-doc; Title of delta-doc, so if the citation is to one of those/);
    expect(note).not.toContain("beta-doc");
  });

  it("narrower relatives of a partly held document: candidates stay, the clause is added", () => {
    const r = resolve("Alpha Article 3");
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("none");
    expect(r.candidates.map((c) => c.id)).toEqual(["regulation://alpha/art-3-a", "regulation://alpha/art-3-b"]);
    expect(r.coverage_note).toMatch(/narrower provision\(s\).*holds only part of Title of alpha-doc/s);
  });

  it("the container note carries no clause: the provision's text is held, inside the container", () => {
    const r = resolve("Alpha Article 1(a)");
    expect(r.match).toBeNull();
    expect(r.coverage_note).toContain("the provision containing it");
    expect(r.coverage_note).not.toMatch(/only part/);
  });

  it("never turns a decline into a match: matching is identical with and without holdings", () => {
    for (const q of ["Alpha Article 1", "Alpha Article 99", "Alpha Article 3", "Beta Article 1", "Article 99", "Gamma Article 2", "Alpha Article 1(a)"]) {
      const a = resolve(q);
      const b = resolve(q, false);
      expect(a.match?.id ?? null).toBe(b.match?.id ?? null);
      expect(a.confidence).toBe(b.confidence);
      expect(a.candidates).toEqual(b.candidates);
      expect(a.unmatched_segments).toEqual(b.unmatched_segments);
    }
  });

  it("without the third parameter the notes are exactly what they were", () => {
    expect(resolve("Alpha Article 99", false).coverage_note).toBe(
      'Nothing in this corpus is numbered 99 in the document named. Try search_regulation with the citation\'s key words.',
    );
    expect(resolve("Alpha Article 3", false).coverage_note).not.toMatch(/only part/);
  });

  it("a hit is untouched by holdings", () => {
    const r = resolve("Alpha Article 1");
    expect(r.match?.id).toBe("regulation://alpha/art-1");
    expect(r.coverage_note).toBeUndefined();
  });

  it("MetaAdapter.resolveCitation passes the holdings", async () => {
    const r = await createFileAdapters(parsed).meta.resolveCitation("Alpha Article 99");
    expect(r.coverage_note).toMatch(/only part of Title of alpha-doc/);
  });
});

describe("missingRecordClause", () => {
  it("is one function, so the tool layer and any other caller cannot word the cases differently", () => {
    const h = computeHoldings(parsed.regulation, parsed.sources);
    expect(missingRecordClause(parsed.regulation, h, "regulation://alpha/zz")).toMatch(/only part/);
    expect(missingRecordClause(parsed.regulation, h, "regulation://nowhere/zz")).toMatch(/No document with the id prefix/);
  });
});

// ── the linter ──────────────────────────────────────────────────────────────────

describe("linting a coverage declaration", () => {
  it("a source declaring coverage for a document with no records is a warning", () => {
    const orphan = SourceSchema.parse(source("zz", "ghost-doc", { coverage: "partial" }));
    const w = holdingsWarnings(parsed.regulation, [...parsed.sources, orphan]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("ghost-doc");
    expect(w[0]).toContain("no regulation records");
  });

  it("an undeclared source with no records is not a finding, and a declared one with records is clean", () => {
    const quiet = SourceSchema.parse(source("zz", "ghost-doc"));
    expect(holdingsWarnings(parsed.regulation, [...parsed.sources, quiet])).toEqual([]);
  });

  it("corpusWarnings carries it next to the staleness warnings", () => {
    const orphan = SourceSchema.parse(source("zz", "ghost-doc", { coverage: "full" }));
    const w = corpusWarnings(
      { regulation: parsed.regulation, tests: [], checks: [], playbooks: [], sources: [orphan] },
      new Date("2026-01-02"),
    );
    expect(w.some((x) => x.includes("ghost-doc"))).toBe(true);
  });
});

// ── eval I12, driven over a synthetic corpus file ───────────────────────────────

describe("eval I12", () => {
  const dir = mkdtempSync(join(tmpdir(), "prudent-i12-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = async (name: string, corpus: unknown) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(corpus));
    const session = await openSession({ corpusFile: file });
    try {
      return await declineOnPartialDocumentSaysSo(session);
    } finally {
      await session.close();
    }
  };

  it("binds on a document declared partial and finds the server says so", async () => {
    const r = await run("partial.json", { regulation, sources });
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when no document declares partial", async () => {
    const r = await run("none.json", {
      regulation,
      sources: sources.map((s) => { const { coverage: _c, ...rest } = s as typeof s & { coverage?: string }; return rest; }),
    });
    expect(r.applicable).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it("is not applicable when only full or undeclared documents are held", async () => {
    const r = await run("full.json", { regulation: regulation.filter((x) => x.document_id === "beta-doc" || x.document_id === "gamma-doc"), sources });
    expect(r.applicable).toBe(false);
  });

  it("goes fatal on a server whose misses say nothing about partial holding", async () => {
    // A stub session: the server of the bug report, where a miss reads as "no such provision".
    const trace = (text: string, isError: boolean, json: unknown = null) => ({ tool: "", args: {}, text, chars: text.length, tokens: 0, ms: 0, isError, json });
    const stub = {
      async call(tool: string) {
        if (tool === "get_corpus_info") return trace("{}", false, { holdings: [{ document_id: "d", title: "Doc", partial: true }] });
        if (tool === "search_regulation") return trace("{}", false, { results: [{ id: "regulation://d/a-1", document_id: "d" }] });
        if (tool === "resolve_citation") {
          return trace("{}", false, { match: null, coverage_note: "Nothing in this corpus is numbered 99999 in the document named." });
        }
        return trace("No record for the id. Verify the id with search_regulation.", true);
      },
    } as unknown as Parameters<typeof declineOnPartialDocumentSaysSo>[0];
    const r = await declineOnPartialDocumentSaysSo(stub);
    expect(r.applicable).toBe(true);
    expect(r.findings.map((f) => f.id).sort()).toEqual([
      "I12/expand_regulation",
      "I12/get_regulation",
      "I12/get_regulation_tree",
      "I12/resolve_citation",
    ]);
    expect(r.findings.every((f) => f.severity === "fatal")).toBe(true);
  });
});
