import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { placeholdersAreMarked } from "../evals/invariants.ts";
import { adapters } from "../src/adapters.ts";
import type { RegulationAdapter } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import { MAX_PLACEHOLDER_SPANS, MAX_PLACEHOLDER_SPAN_CHARS, preAdoptionPlaceholders, withPlaceholderFlag } from "../src/placeholders.ts";
import { RegulationSchema } from "../src/schema.ts";
import { createServer } from "../src/server.ts";
import { corpusInfo } from "../src/validate.ts";

// ── Pre-adoption placeholders are computed and flagged ───────────────────────────
//
// A text written before a standard was adopted names it "Regulation (EU) xx/xx".
// Everything here is synthetic: the spellings are re-typed from the shapes found
// in a survey of a real corpus, and no sentence in this file is served law.

const spans = (text: string): string[] => preAdoptionPlaceholders(text)?.spans ?? [];

describe("preAdoptionPlaceholders: every spelling", () => {
  const spellings: Array<[string, string]> = [
    ["lower-case halves", "as set out in Regulation (EU) xx/xx [RTS on synthetic topic] for the purpose"],
    ["serial/YEAR era, with No", "in accordance with Article 2 of Regulation (EU) No xx/xxx [RTS on synthetic topic]."],
    ["no (EU)", "in accordance with Article 3 of Regulation xx/xxx [RTS on synthetic topic] and"],
    ["upper case", "laid down in Regulation (EU) XX/XXXX"],
    ["year stem 20xx", "see Commission Delegated Regulation (EU) 20xx/xx"],
    ["year stem 201x", "see Directive (EU) 201x/xx"],
    ["bracketed dots", "see Regulation (EU) [...]/[...] on the topic"],
    ["bracketed ellipsis", "see Regulation (EU) […]/[…] on the topic"],
    ["one half real, one stand-in", "see Regulation (EU) 2021/xx and"],
    ["stand-in serial, old era", "see Regulation (EU) No xx/2013"],
    ["other kinds", "see Decision (EU) xx/xx and Guideline (EU) xx/xx"],
    ["No. with a full stop", "see Regulation (EU) No. xx/xxx"],
    ["spaced slash", "see Regulation (EU) xx / xx"],
  ];
  for (const [name, text] of spellings) {
    it(name, () => {
      const found = preAdoptionPlaceholders(text);
      expect(found).not.toBeNull();
      expect(found!.spans.length).toBeGreaterThan(0);
      // The span is a quotation of the text, not a paraphrase.
      for (const span of found!.spans) expect(text.replace(/\s+/g, " ")).toContain(span.replace(/…$/, ""));
    });
  }

  it("keeps the descriptor drafters append, the only thing saying which instrument is meant", () => {
    expect(spans("per Regulation (EU) xx/xx [RTS on synthetic topic], institutions")).toEqual([
      "Regulation (EU) xx/xx [RTS on synthetic topic]",
    ]);
  });
});

describe("preAdoptionPlaceholders: nothing else triggers it", () => {
  const clean = [
    "Regulation (EU) No 575/2013",
    "Regulation (EU) 2021/930 and Regulation (EU) 2016/1066",
    "Delegated Regulation (EU) No 529/2014, Article 4(1)",
    "Directive 2013/36/EU and Decision (EU) 2017/1234",
    "Guideline (EU) 2017/697 of the European Central Bank",
    "Regulation 1/2 applies",
    // Only an act number is a placeholder: prose with an x or an elision is not.
    "the quoted passage reads: “after the synthetic date […]”. Furthermore, Article 5(2)",
    "an elision [...] in a quotation, then Regulation (EU) 575/2013",
    "the value of xx is unknown and Regulation concerns xx",
    "notify with the reference ‘ACME/GL/201x/xx’ (a guideline's own reference, no instrument named)",
    "Article 178 of the CRR, paragraph 3/4 and 12/2",
    "",
  ];
  for (const text of clean) {
    it(`no placeholder in ${JSON.stringify(text.slice(0, 50))}`, () => {
      expect(preAdoptionPlaceholders(text)).toBeNull();
    });
  }

  it("a numbered act next to a placeholder is not itself reported", () => {
    expect(spans("Regulation (EU) No 575/2013 and Regulation (EU) xx/xx")).toEqual(["Regulation (EU) xx/xx"]);
  });
});

describe("preAdoptionPlaceholders: spans", () => {
  it("lists a repeated placeholder once", () => {
    const found = preAdoptionPlaceholders("Regulation (EU) xx/xx and again Regulation (EU) xx/xx");
    expect(found).toEqual({ spans: ["Regulation (EU) xx/xx"], total: 1 });
  });

  it("returns at most three spans and says how many there were", () => {
    const text = [1, 2, 3, 4, 5].map((n) => `Regulation (EU) xx/${"x".repeat(n > 2 ? 3 : 2)} [RTS ${n}]`).join(" and ");
    const found = preAdoptionPlaceholders(text)!;
    expect(found.spans.length).toBe(MAX_PLACEHOLDER_SPANS);
    expect(found.total).toBe(5);
  });

  it("cuts a span to 120 characters", () => {
    const long = `Regulation (EU) xx/xx [${"synthetic ".repeat(8).trim()}]`;
    for (const span of spans(long)) expect(span.length).toBeLessThanOrEqual(MAX_PLACEHOLDER_SPAN_CHARS);
    expect(spans(long).length).toBe(1);
  });
});

describe("withPlaceholderFlag", () => {
  it("leaves a body without a placeholder untouched (same object, no keys)", () => {
    const body = { id: "regulation://a/b", text: "Regulation (EU) No 575/2013 applies." };
    expect(withPlaceholderFlag(body)).toBe(body);
    expect(Object.keys(withPlaceholderFlag(body))).toEqual(["id", "text"]);
  });

  it("leads with the flag and a notice saying what the placeholder is not", () => {
    const out = withPlaceholderFlag({ id: "regulation://a/b", text: "see Regulation (EU) xx/xx [RTS]" }) as Record<string, unknown>;
    expect(Object.keys(out).slice(0, 2)).toEqual(["pre_adoption_placeholders", "notice"]);
    expect(out["notice"]).toMatch(/placeholder is not a citation/);
    expect(out["notice"]).toMatch(/elsewhere in this library or not at all/);
    expect(out["notice"]).toMatch(/current state of the law/);
  });

  it("states how many references there were when the list was cut", () => {
    const text = ["a", "b", "c", "d"].map((t) => `Regulation (EU) xx/xx [RTS ${t}]`).join(" ");
    const out = withPlaceholderFlag({ text }) as Record<string, unknown>;
    expect(out["notice"]).toMatch(/4 such references; the first 3 are listed/);
  });

  it("keeps a notice the body already carries and puts its own under a distinct key", () => {
    const out = withPlaceholderFlag({ text: "see Regulation (EU) xx/xx", notice: "existing" }) as Record<string, unknown>;
    expect(out["notice"]).toBe("existing");
    expect(String(out["placeholder_notice"])).toMatch(/not a citation/);
  });
});

// ── Over the wire ───────────────────────────────────────────────────────────────

const record = (n: number, text: string, extra: Record<string, unknown> = {}) => ({
  id: `regulation://acme/p-${n}`,
  framework: "acme",
  document_id: "acme-gl",
  document_version: "2024-05-01",
  citation: `Acme paragraph ${n}`,
  text,
  ...extra,
});
const flagged = record(1, "Institutions should apply Regulation (EU) xx/xx [RTS on a synthetic topic] when estimating.", { children: ["regulation://acme/p-3"] });
const numbered = record(2, "Institutions should apply Regulation (EU) 2021/930 and Regulation (EU) No 575/2013 when estimating.");
const child = record(3, "Child paragraph that names Regulation (EU) xx/xx [RTS on another topic].", { parent: flagged.id });
const corpus = CorpusFileSchema.parse({
  regulation: [flagged, numbered, child],
  sources: [
    {
      id: "source://acme/acme-gl",
      title: "Acme guideline",
      framework: "acme",
      document_id: "acme-gl",
      doc_type: "guideline",
      status: "current",
      published: "2012-01-01",
      verified: new Date().toISOString().slice(0, 10),
    },
  ],
});

describe("pre_adoption_placeholders on the regulation tools", () => {
  let client: Client | undefined;
  let saved: RegulationAdapter;

  // Swapped in and restored around EVERY test: the module cache is shared with
  // every other test file and no test here depends on which sibling ran first.
  beforeEach(async () => {
    saved = adapters.regulation;
    adapters.regulation = createFileAdapters(corpus).regulation;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "placeholders-test", version: "0.0.0" });
    await client.connect(clientTransport);
    // Listing caches the output schemas, so callTool validates structured results.
    await client.listTools();
  });
  afterEach(async () => {
    adapters.regulation = saved;
    await client?.close();
    client = undefined;
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client!.callTool({ name, arguments: args });
    return { isError: res.isError === true, body: (res.structuredContent ?? {}) as Record<string, unknown> };
  }

  const got = async (id: string, extra: Record<string, unknown> = {}) => {
    const r = await call("get", { ids: id, ...extra });
    const notes = (r.body["notes"] ?? []) as Array<{ type: string; text: string; applies_to?: string[] }>;
    return { ...r, notes, placeholder: notes.find((n) => n.type === "placeholder"), record: (r.body["records"] as Array<Record<string, unknown>> | undefined)?.[0] };
  };

  it("get flags a record whose text names a placeholder, quoting what it names", async () => {
    const r = await got(flagged.id);
    expect(r.isError).toBe(false);
    expect(r.placeholder?.text).toMatch(/not a citation/);
    expect(r.placeholder?.text).toContain("“Regulation (EU) xx/xx [RTS on a synthetic topic]”");
    expect(r.record?.["text"]).toBe(flagged.text);
  });

  it("get leaves a record with numbered acts exactly as it was", async () => {
    const r = await got(numbered.id);
    expect(r.isError).toBe(false);
    expect(r.placeholder).toBeUndefined();
    expect("notes" in r.body).toBe(false);
  });

  it("get serves the unflagged record byte for byte as the adapter holds it", async () => {
    const r = await got(numbered.id);
    const held = await createFileAdapters(corpus).regulation.get(numbered.id as never);
    expect(r.record).toEqual(JSON.parse(JSON.stringify(held)));
  });

  it("the placeholder note sits beside a version note without either replacing the other", async () => {
    const r = await got(flagged.id, { as_of: "2024-12-31" });
    expect(r.notes.map((n) => n.type).sort()).toEqual(["placeholder", "version"]);
    expect(r.placeholder?.text).not.toMatch(/as_of/);
  });

  it("search rows carry no flag: the note is one get away", async () => {
    const r = await call("search", { query: "estimating", detail: "full" });
    const rows = r.body["results"] as Array<Record<string, unknown>>;
    expect(rows.map((x) => x["id"])).toContain(flagged.id);
    for (const row of rows) {
      expect("pre_adoption_placeholders" in row).toBe(false);
      expect(() => RegulationSchema.parse(row)).not.toThrow();
    }
  });
});

// ── validate-corpus: an information line ───────────────────────────────────────

describe("corpusInfo", () => {
  const regs = corpus.regulation;
  const input = { regulation: regs, tests: [], checks: [], playbooks: [] };

  it("counts records and documents that carry a placeholder", () => {
    const lines = corpusInfo(input);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/^2 regulation record\(s\) in 1 document\(s\)/);
  });

  it("is silent on a corpus without one", () => {
    expect(corpusInfo({ ...input, regulation: [regs[1]!] })).toEqual([]);
  });
});

describe("bun run validate", () => {
  const dir = mkdtempSync(join(tmpdir(), "prudent-placeholders-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function validate(file: string) {
    const p = Bun.spawnSync(["bun", "run", "scripts/validate-corpus.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CORPUS_FILE: file },
    });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  }

  it("prints an info line, exits 0 and raises no warning", () => {
    const file = join(dir, "with.json");
    writeFileSync(file, JSON.stringify(corpus));
    const r = validate(file);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/info: 2 regulation record\(s\) in 1 document\(s\) name an instrument by a pre-adoption placeholder/);
    expect(r.err).not.toMatch(/warning/);
  });

  it("prints no info line for a corpus without one", () => {
    const file = join(dir, "without.json");
    writeFileSync(file, JSON.stringify({ ...corpus, regulation: [numbered] }));
    const r = validate(file);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/pre-adoption/);
  });
});

// ── eval I14 ────────────────────────────────────────────────────────────────────

describe("eval I14", () => {
  const dir = mkdtempSync(join(tmpdir(), "prudent-i14-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function run(name: string, content: unknown) {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(content));
    const session = await openSession({ corpusFile: file });
    try {
      return await placeholdersAreMarked(session);
    } finally {
      await session.close();
    }
  }

  it("binds and passes on a corpus that carries placeholders", async () => {
    const r = await run("with.json", corpus);
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when no served record carries a placeholder", async () => {
    const r = await run("without.json", { ...corpus, regulation: [numbered] });
    expect(r.applicable).toBe(false);
    expect(r.findings).toEqual([]);
  });

  // A stand-in session replaying a server that serves the record unflagged, or
  // flags a record that names nothing - an invariant that cannot fail measures nothing.
  function stub(serve: (tool: string, id: string) => Record<string, unknown>): Session {
    const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
      tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
    });
    return {
      tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
      async close() {},
      async call(tool, args = {}) {
        if (tool === "search_regulation") {
          return trace(tool, args, { results: [{ id: flagged.id }, { id: numbered.id }] });
        }
        return trace(tool, args, serve(tool, String(args["id"])));
      },
    };
  }
  const bodyFor = (id: string) => (id === flagged.id ? flagged : numbered);

  it("fails a server that serves the placeholder unmarked", async () => {
    const r = await placeholdersAreMarked(stub((_t, id) => ({ ...bodyFor(id) })));
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal").map((f) => f.id).sort()).toEqual(["I14/get_regulation"]);
  });

  it("fails a server whose flag carries no notice that it is not a citation", async () => {
    const r = await placeholdersAreMarked(
      stub((_t, id) => (id === flagged.id ? { pre_adoption_placeholders: ["Regulation (EU) xx/xx"], ...flagged } : { ...numbered })),
    );
    expect(r.findings.some((f) => f.severity === "fatal" && f.evidence.join(" ").includes("notice does not say"))).toBe(true);
  });

  it("fails a server that flags a record naming only numbered acts", async () => {
    const r = await placeholdersAreMarked(
      stub((_t, id) => ({ ...bodyFor(id), pre_adoption_placeholders: ["Regulation (EU) 2021/930"], notice: "not a citation" })),
    );
    expect(r.findings.some((f) => f.id.startsWith("I14/false-flag"))).toBe(true);
  });

  it("passes a server that marks the record and leaves the numbered one alone", async () => {
    const r = await placeholdersAreMarked(
      stub((_t, id) =>
        id === flagged.id
          ? { pre_adoption_placeholders: ["Regulation (EU) xx/xx"], notice: "the placeholder is not a citation", ...flagged }
          : { ...numbered },
      ),
    );
    expect(r.applicable).toBe(true);
    expect(r.findings).toEqual([]);
  });
});
