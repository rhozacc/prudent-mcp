import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { adapters } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import type { Regulation } from "../src/schema.ts";
import {
  rankedRecords,
  rankedSearch,
  rankingOf,
  regulationRanking,
  regulationSearchFields,
  stem,
  type Glossary,
} from "../src/search.ts";
import { createServer } from "../src/server.ts";

// BM25F is the one ranking definition. These tests pin what it was introduced
// for, on synthetic records: the rare word decides, a heading is searchable,
// background material is out of the default, an abbreviation reaches the words
// the text uses.

const reg = (slug: string, text: string, over: Partial<Regulation> = {}): Regulation => ({
  id: `regulation://gl/${slug}` as Regulation["id"],
  framework: "eba",
  document_id: "gl",
  document_version: "2026-01-01",
  citation: `Paragraph ${slug}`,
  text,
  commentary: [],
  children: [],
  ...over,
});

const ids = (hits: Array<{ record: Regulation }>) => hits.map((h) => h.record.id.replace("regulation://gl/", ""));
const search = (items: Regulation[], q: string, opts: Parameters<typeof regulationRanking>[0] = {}) =>
  rankedSearch(items, q, regulationSearchFields(q), undefined, regulationRanking(opts));

describe("stem", () => {
  it("folds plurals but keeps words whose final s belongs to them", () => {
    expect(stem("models")).toBe("model");
    expect(stem("policies")).toBe("policy");
    expect(stem("classes")).toBe("class");
    expect(stem("analysis")).toBe("analysis");
    expect(stem("status")).toBe("status");
    expect(stem("process")).toBe("process");
  });

  it("meets the forms of one verb", () => {
    const family = (words: string[]) => new Set(words.map(stem)).size;
    expect(family(["estimate", "estimates", "estimating", "estimated"])).toBe(1);
    expect(family(["calibrate", "calibrates", "calibrating", "calibrated"])).toBe(1);
    expect(family(["assess", "assesses", "assessed"])).toBe(1);
    expect(family(["model", "models", "modelling", "modeling", "modeled"])).toBe(1);
  });

  it("does not fold words a derivation apart: they mean different things in a regulation", () => {
    // Folding these cost recall on a real corpus (see the note on `stem`).
    expect(stem("representativeness")).not.toBe(stem("representative"));
    expect(stem("operative")).not.toBe(stem("operation"));
    expect(stem("calibration")).not.toBe(stem("calibrate"));
    expect(stem("assessment")).not.toBe(stem("assess"));
  });

  it("leaves numbers, short words and unrelated words alone", () => {
    expect(stem("180")).toBe("180");
    expect(stem("2017")).toBe("2017");
    expect(stem("pd")).toBe("pd");
    expect(stem("used")).toBe("used"); // would leave a two-letter stem
    expect(stem("string")).toBe("string"); // no vowel left after "ing"
    expect(stem("default")).not.toBe(stem("data"));
  });

  it("is the same function on both sides: a record is found by another form of its word", () => {
    const hits = search([reg("1", "Institutions shall document how the parameter was estimated.")], "estimating");
    expect(ids(hits)).toEqual(["1"]);
    expect(hits[0]!.coverage).toBe(1);
  });
});

describe("rankedSearch (BM25F)", () => {
  it("a short operative paragraph with the rare term outranks a long record repeating the common ones", () => {
    const operative = reg("operative", "Institutions shall demonstrate representativeness of the data used.");
    const long = reg(
      "long",
      `${"The data used in the model data quality data review data sources. ".repeat(40)}Representativeness is discussed elsewhere.`,
    );
    // The common words are everywhere, so they say little; "representativeness" is in two records.
    const filler = Array.from({ length: 30 }, (_, i) => reg(`f${i}`, "The data and the model are described in this paragraph."));
    const hits = search([long, ...filler, operative], "representativeness of the data used");
    expect(ids(hits)[0]).toBe("operative");
  });

  it("repetition saturates: eight mentions do not beat covering both terms", () => {
    const both = reg("both", "model lifecycle");
    const many = reg("many", "model model model model model model model model");
    expect(ids(search([many, both], "model lifecycle"))).toEqual(["both", "many"]);
  });

  it("finds a paragraph reachable only through its heading path", () => {
    const under = reg("31", "The institution shall do this for each of the cases listed.", {
      heading_path: ["Section 4", "Section 4.2.4 Representativeness of the data"],
    });
    const other = reg("32", "The institution shall do something else entirely.");
    const hits = search([other, under], "representativeness");
    expect(ids(hits)).toEqual(["31"]);
    expect(hits[0]!.matched.field).toBe("heading_path");
    expect(hits[0]!.matched.excerpt).toBe("Section 4.2.4 Representativeness of the data");
  });

  it("a heading outweighs the same word in the body", () => {
    const heading = reg("h", "The institution shall do this.", { heading_path: ["Calibration"] });
    const body = reg("b", "The institution shall do calibration.");
    expect(ids(search([body, heading], "calibration"))).toEqual(["h", "b"]);
  });

  it("leaves background out by default and returns it with scope: all", () => {
    const op = reg("op", "Institutions shall assess representativeness.", { role: "operative" });
    const bg = reg("bg", "Respondents asked how representativeness should be assessed.", { role: "background" });
    const unclassified = reg("un", "Representativeness is assessed per portfolio.");
    expect(ids(search([bg, op, unclassified], "representativeness")).sort()).toEqual(["op", "un"]);
    expect(ids(search([bg, op, unclassified], "representativeness", { scope: "all" })).sort()).toEqual(["bg", "op", "un"]);
  });

  it("excluding a record does not change what the others score", () => {
    const a = reg("a", "calibration target", { role: "operative" });
    const b = reg("b", "calibration of the target", { role: "background" });
    const all = search([a, b], "calibration", { scope: "all" }).find((h) => h.record.id.endsWith("/a"))!;
    const def = search([a, b], "calibration").find((h) => h.record.id.endsWith("/a"))!;
    expect(def.score).toBe(all.score);
  });

  it("a section node and a metadata-only record rank below an operative one that matches as well", () => {
    const text = "Institutions shall apply the margin of conservatism.";
    const operative = reg("op", text);
    const section = reg("sec", text, { kind: "section" });
    const meta = reg("meta", text, { is_metadata_only: true });
    expect(ids(search([section, meta, operative], "margin of conservatism"))).toEqual(["op", "meta", "sec"]);
  });

  it("a record matched only loosely never outranks one that matched a word, however it scores", () => {
    // "recalibrations" contains "calibrat" and is rare, so on score alone it could win.
    const loose = reg("loose", "recalibrations recalibrations recalibrations", { citation: "Recalibrations" });
    const real = reg("real", "The calibration target is set annually.");
    const filler = Array.from({ length: 20 }, (_, i) => reg(`f${i}`, "The target is set annually."));
    const hits = search([loose, ...filler, real], "calibration");
    expect(ids(hits)[0]).toBe("real");
    const looseHit = hits.find((h) => h.record.id.endsWith("/loose"))!;
    expect(looseHit.coverage).toBe(0);
    expect(hits.indexOf(looseHit)).toBeGreaterThan(hits.findIndex((h) => h.coverage > 0 && h.record.id.endsWith("/real")));
  });

  it("builds the index once per item list and notices when the list changes", () => {
    const items = [reg("1", "alpha beta"), reg("2", "alpha gamma")];
    const fields = regulationSearchFields("alpha");
    expect(rankedSearch(items, "alpha", fields)).toHaveLength(2);
    items.push(reg("3", "alpha delta"));
    expect(rankedSearch(items, "alpha", fields)).toHaveLength(3);
    expect(rankedSearch(items, "delta", fields).map((h) => h.record.id)).toEqual(["regulation://gl/3"]);
  });
});

describe("glossary", () => {
  const glossary: Glossary = {
    rds: ["reference data set"],
    moc: ["margin of conservatism"],
    "cat a": ["category a"],
  };
  const full = reg("full", "The reference data set shall be representative of the portfolio.");
  const abbreviated = reg("abbr", "The RDS is documented in the model file.");
  const unrelated = reg("other", "The data are stored securely.");

  it("expands an abbreviation by OR into the words the texts use", () => {
    const hits = search([unrelated, full, abbreviated], "rds", { glossary });
    expect(ids(hits)).toContain("full");
    expect(ids(hits)).toContain("abbr");
  });

  it("ranks the record that says what the caller typed ahead of one reached only by expansion", () => {
    const hits = search([full, abbreviated], "rds", { glossary });
    expect(ids(hits)).toEqual(["abbr", "full"]);
  });

  it("counts a record that carries the whole phrase as covering the abbreviation", () => {
    const hits = search([full, unrelated], "rds", { glossary });
    const f = hits.find((h) => h.record.id.endsWith("/full"))!;
    expect(f.coverage).toBe(1);
    // "data" alone does not carry the phrase, so it is not coverage.
    const o = hits.find((h) => h.record.id.endsWith("/other"));
    expect(o?.coverage ?? 0).toBe(0);
  });

  it("counts the phrase only where its words run together", () => {
    // Every word is there, but nothing says "reference data set": the words of a
    // long record are all present somewhere, and that is not the phrase.
    const scattered = reg("scatter", "A set of tables. The data room. Reference material follows.");
    expect(ids(search([scattered, full], "rds", { glossary }))).toEqual(["full"]);
  });

  it("scores the phrase on its own frequency, so a rare phrase outweighs a common one", () => {
    const common = Array.from({ length: 20 }, (_, i) => reg(`c${i}`, "The margin of conservatism applies here."));
    const rare = reg("rare", "The reference data set is described here.");
    const hits = search([...common, rare], "rds moc", { glossary });
    expect(ids(hits)[0]).toBe("rare");
  });

  it("does nothing without a glossary", () => {
    expect(ids(search([full], "rds"))).toEqual([]);
  });

  it("matches a multi-word key against consecutive query words, stopwords included", () => {
    const catA = reg("cat", "Exposures in category a are treated separately.");
    expect(ids(search([catA, unrelated], "cat a", { glossary }))).toEqual(["cat"]);
    expect(search([catA], "cat a", { glossary })[0]!.coverage).toBeGreaterThan(0);
  });

  it("reaches the adapters: the file adapter expands, and carries the glossary on meta", async () => {
    const corpus = CorpusFileSchema.parse({ regulation: [full, abbreviated, unrelated], glossary });
    const adapters = createFileAdapters(corpus);
    expect((await adapters.regulation.search("rds")).map((r) => r.id).sort()).toEqual([
      "regulation://gl/abbr",
      "regulation://gl/full",
    ]);
    expect(await adapters.meta.glossary?.()).toEqual(glossary);
  });

  it("the file adapter leaves background out unless asked", async () => {
    const bg = reg("bg", "Respondents discussed representativeness.", { role: "background" });
    const op = reg("op", "Institutions shall assess representativeness.", { role: "operative" });
    const adapters = createFileAdapters(CorpusFileSchema.parse({ regulation: [bg, op] }));
    expect((await adapters.regulation.search("representativeness")).map((r) => r.id)).toEqual(["regulation://gl/op"]);
    expect(
      (await adapters.regulation.search("representativeness", { scope: "all" })).map((r) => r.id).sort(),
    ).toEqual(["regulation://gl/bg", "regulation://gl/op"]);
  });
});

describe("the remembered ranking", () => {
  const items = [reg("1", "alpha beta"), reg("2", "alpha"), reg("3", "gamma")];
  const fields = regulationSearchFields("alpha");

  it("is read back for the list rankedRecords returned, and for no other", () => {
    const records = rankedRecords(items, "alpha", fields);
    expect(records.map((r) => r.id)).toEqual(["regulation://gl/2", "regulation://gl/1"]);
    expect(rankingOf(records)?.map((m) => m.record.id)).toEqual(records.map((r) => r.id));
    expect(rankingOf([...records])).toBeUndefined(); // a copy is a different list
    expect(rankingOf(items)).toBeUndefined();
  });

  it("is not trusted once the list has been reordered or cut", () => {
    const records = rankedRecords(items, "alpha", fields);
    records.reverse();
    expect(rankingOf(records)).toBeUndefined();
    const cut = rankedRecords(items, "alpha", fields);
    cut.pop();
    expect(rankingOf(cut)).toBeUndefined();
  });

  it("gives the same matches as ranking afresh, excerpts included", () => {
    const long = reg("long", `${"Padding sentence. ".repeat(30)}The alpha target sits here.${" More padding.".repeat(30)}`);
    const list = [items[0]!, long];
    const remembered = rankingOf(rankedRecords(list, "alpha", fields))!;
    const fresh = rankedSearch(list, "alpha", fields);
    expect(remembered.map((m) => [m.record.id, m.score, m.coverage, m.matched])).toEqual(
      fresh.map((m) => [m.record.id, m.score, m.coverage, m.matched]),
    );
  });

  it("cuts an excerpt only when it is read, and the same one every time", () => {
    const [m] = rankedSearch([reg("x", "alpha is here.")], "alpha", fields);
    const first = m!.matched;
    expect(m!.matched).toBe(first);
    expect(first).toEqual({ field: "text", excerpt: "alpha is here.", field_chars: 14 });
  });
});

describe("search_regulation over the wire", () => {
  let client: Client | undefined;
  let saved: typeof adapters;

  const bg = reg("bg", "Respondents discussed how representativeness should be shown.", { role: "background" });
  const op = reg("op", "Institutions shall show representativeness of the reference data set.", { role: "operative" });
  const corpus = CorpusFileSchema.parse({ regulation: [bg, op], glossary: { rds: ["reference data set"] } });
  const files = createFileAdapters(corpus);

  // An adapter written outside this repo: ranks with the shared function but
  // leaves no remembered ranking, so the tool layer must rank again.
  const outside = {
    ...files,
    regulation: {
      ...files.regulation,
      async search(query: string, options?: { scope?: "default" | "all" }) {
        const ranked = rankedSearch(
          corpus.regulation,
          query,
          regulationSearchFields(query),
          undefined,
          regulationRanking({ scope: options?.scope, glossary: corpus.glossary }),
        );
        return ranked.map((m) => m.record);
      },
    },
  };

  beforeEach(async () => {
    saved = { ...adapters };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "bm25-test", version: "0.0.0" });
    await client.connect(clientTransport);
    await client.listTools();
  });
  afterEach(async () => {
    Object.assign(adapters, saved);
    await client?.close();
    client = undefined;
  });

  async function call(args: Record<string, unknown>) {
    const res = await client!.callTool({ name: "search_regulation", arguments: args });
    return (res.structuredContent ?? {}) as Record<string, any>;
  }

  for (const [label, impl] of [["the file adapter", files], ["an adapter without a remembered ranking", outside]] as const) {
    describe(label, () => {
      beforeEach(() => {
        Object.assign(adapters, impl);
      });

      it("leaves background out by default and includes it with scope: all", async () => {
        const def = await call({ query: "representativeness" });
        expect(def.results.map((r: any) => r.id)).toEqual(["regulation://gl/op"]);
        const all = await call({ query: "representativeness", scope: "all" });
        expect(all.results.map((r: any) => r.id).sort()).toEqual(["regulation://gl/bg", "regulation://gl/op"]);
        expect(all.total_matches).toBe(2);
      });

      it("expands an abbreviation and still gives the row its coverage and excerpt", async () => {
        const res = await call({ query: "rds" });
        expect(res.results.map((r: any) => r.id)).toEqual(["regulation://gl/op"]);
        expect(res.results[0].coverage).toBe(1);
        expect(res.results[0].matched_excerpt).toContain("reference data set");
        expect(res.best_coverage).toBe(1);
      });

      it("counts every match but builds only the requested page", async () => {
        const res = await call({ query: "representativeness", scope: "all", limit: 1, offset: 1 });
        expect(res.total_matches).toBe(2);
        expect(res.returned).toBe(1);
        expect(res.truncated).toBe(false);
      });
    });
  }
});
