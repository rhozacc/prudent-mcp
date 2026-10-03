import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { adapters } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import { distinctQueryTokens } from "../src/search.ts";
import { createServer } from "../src/server.ts";
import { paginate, serialize, weakMatchNotice, withQueryCoverage } from "../src/tools/shared.ts";

// ── Search rows say how much of the query they matched ─────────────────────────
//
// "Showing 20 of N matches" for a concept the corpus does not hold is a page
// of hits on the commonest terms with nothing to say that no hit covers the
// distinctive ones. Ranking already knew; these pin that the four search tools
// now say it. Every record below is synthetic.

const WORDS = ["alpha", "beta", "gamma", "delta"];

/** A prose body that contains the first `n` of WORDS, and filler otherwise. */
const body = (n: number): string => `Synthetic filler. ${WORDS.slice(0, n).join(" ")} end.`;

// 4 records match 4 words, 3 match 2, the rest match only the first. Written so
// that the best hit is NOT on the first page of a small limit once ranked.
const COVERAGES = [1, 1, 1, 1, 1, 1, 2, 2, 2, 4, 3, 1];

const day = "2024-05-01";
const regulation = COVERAGES.map((n, i) => ({
  id: `regulation://acme/art-${i}`,
  framework: "acme",
  document_id: "acme-reg",
  document_version: day,
  citation: `Acme Article ${i}`,
  text: body(n),
}));
const checks = COVERAGES.map((n, i) => ({
  id: `check://area/topic-${i}`,
  name: `Synthetic check ${i}`,
  expectation: body(n),
  last_updated: day,
}));
const tests = COVERAGES.map((n, i) => ({
  id: `test://acme/t-${i}`,
  name: `Synthetic test ${i}`,
  purpose: body(n),
  last_updated: day,
}));
const playbooks = COVERAGES.map((n, i) => ({
  id: `playbook://area/p-${i}`,
  area: `Synthetic area ${i} ${WORDS.slice(0, n).join(" ")}`,
  last_updated: day,
}));

const corpus = CorpusFileSchema.parse({ regulation, checks, tests, playbooks });
const files = createFileAdapters(corpus);

type Surface = { tool: string; adapter: "regulation" | "check" | "test" | "playbook"; ids: string[] };
const SURFACES: Surface[] = [
  { tool: "search_regulation", adapter: "regulation", ids: regulation.map((r) => r.id) },
  { tool: "search_checks", adapter: "check", ids: checks.map((r) => r.id) },
  { tool: "search_tests", adapter: "test", ids: tests.map((r) => r.id) },
  { tool: "search_playbooks", adapter: "playbook", ids: playbooks.map((r) => r.id) },
];

// Four words the corpus has, then words it does not.
const ABSENT = ["qqqone", "qqqtwo", "qqqthree", "qqqfour", "qqqfive"];
const STRONG = "alpha beta gamma delta";
const WEAK = `${STRONG} ${ABSENT.join(" ")}`; // 9 meaningful terms; best hit covers 4
const HALF = "alpha beta qqqone qqqtwo"; // best hit covers 2 of 4 - exactly half

describe("search coverage over the wire", () => {
  let client: Client | undefined;
  let saved: typeof adapters;

  // The tools read the module-level `adapters`; swap the synthetic ones in and
  // restore afterwards around EVERY test, so no test depends on a sibling.
  beforeEach(async () => {
    saved = { ...adapters };
    Object.assign(adapters, files);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "coverage-test", version: "0.0.0" });
    await client.connect(clientTransport);
    await client.listTools(); // caches output schemas: callTool validates against them
  });
  afterEach(async () => {
    Object.assign(adapters, saved);
    await client?.close();
    client = undefined;
  });

  async function call(name: string, args: Record<string, unknown>) {
    if (client === undefined) throw new Error("no client");
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return { isError: res.isError === true, text, body: (res.structuredContent ?? {}) as Record<string, any> };
  }

  for (const { tool, adapter: surface, ids } of SURFACES) {
    describe(tool, () => {
      it("gives every concise row its coverage and the envelope its query_tokens and best_coverage", async () => {
        const r = await call(tool, { query: STRONG, limit: 100 });
        expect(r.isError).toBe(false);
        expect(r.body["query_tokens"]).toBe(4);
        expect(r.body["best_coverage"]).toBe(4);
        const rows = r.body["results"] as Array<{ id: string; coverage: number }>;
        expect(rows.length).toBe(ids.length);
        for (const row of rows) {
          const i = ids.indexOf(row.id);
          expect(row.coverage, row.id).toBe(COVERAGES[i]!);
          expect(Number.isInteger(row.coverage)).toBe(true);
        }
        // The same figures are in the text block a client reads.
        expect(JSON.parse(r.text).best_coverage).toBe(4);
      });

      it("best_coverage is the best of the whole ranked set, so page 2 still reports it", async () => {
        const page1 = await call(tool, { query: STRONG, limit: 2, offset: 0 });
        const page2 = await call(tool, { query: STRONG, limit: 2, offset: 6 });
        expect(page1.body["results"][0].coverage).toBe(4);
        // Rows on the later page are weaker, and the envelope does not pretend otherwise.
        expect(Math.max(...page2.body["results"].map((x: { coverage: number }) => x.coverage))).toBeLessThan(4);
        expect(page2.body["best_coverage"]).toBe(4);
        expect(page2.body["query_tokens"]).toBe(4);
      });

      it("raises the weak-match notice below half of the query's terms, and says it plainly", async () => {
        const r = await call(tool, { query: WEAK, limit: 100 });
        expect(r.body["query_tokens"]).toBe(9);
        expect(r.body["best_coverage"]).toBe(4);
        const notice = r.body["notice"] as string;
        expect(notice).toBe(weakMatchNotice(4, 9));
        expect(notice).toMatch(/only 4 of the query's 9 meaningful terms/);
        expect(notice).toMatch(/may not be in this corpus/);
        expect(notice).toMatch(/statement about the corpus, not about the law/);
      });

      it("does not raise it at exactly half, or above", async () => {
        const half = await call(tool, { query: HALF, limit: 100 });
        expect(half.body["query_tokens"]).toBe(4);
        expect(half.body["best_coverage"]).toBe(2);
        expect(half.body["notice"]).toBeUndefined();
        const strong = await call(tool, { query: STRONG, limit: 100 });
        expect(strong.body["notice"]).toBeUndefined();
      });

      it("composes with the truncation notice instead of replacing it", async () => {
        const r = await call(tool, { query: WEAK, limit: 2 });
        const notice = r.body["notice"] as string;
        expect(r.body["truncated"]).toBe(true);
        expect(notice).toContain(`Showing 2 of ${ids.length} matches`);
        expect(notice).toContain("Pass offset: 2");
        expect(notice).toContain(weakMatchNotice(4, 9));
      });

      it("a single-term query is never weak", async () => {
        const r = await call(tool, { query: "alpha", limit: 100 });
        expect(r.body["query_tokens"]).toBe(1);
        expect(r.body["best_coverage"]).toBe(1);
        expect(r.body["notice"]).toBeUndefined();
      });

      it("a single-term stem placed only on partial-word matches carries no weak notice", async () => {
        const r = await call(tool, { query: "alph", limit: 100 });
        expect(r.body["total_matches"]).toBe(ids.length);
        expect(r.body["query_tokens"]).toBe(1);
        // Coverage counts whole words, so a stem honestly reports 0 ...
        expect(r.body["best_coverage"]).toBe(0);
        for (const row of r.body["results"]) expect(row.coverage).toBe(0);
        // ... and that is not "the topic may not be in this corpus".
        expect(r.body["notice"]).toBeUndefined();
      });

      it("a multi-term query whose hits are all partial-word says so, not 'matches only 0 of N'", async () => {
        const r = await call(tool, { query: "alph bet", limit: 100 });
        expect(r.body["total_matches"]).toBe(ids.length);
        expect(r.body["query_tokens"]).toBe(2);
        expect(r.body["best_coverage"]).toBe(0);
        const notice = r.body["notice"] as string;
        expect(notice).toBe(weakMatchNotice(0, 2));
        expect(notice).toMatch(/partial-word matches only/);
        expect(notice).not.toMatch(/only 0 of/);
        expect(notice).not.toMatch(/may not be in this corpus/);
        expect(notice).toMatch(/statement about the corpus, not about the law/);
      });

      it("counts distinct meaningful terms: stopwords and repeats are not terms", async () => {
        const r = await call(tool, { query: "the alpha of alpha and beta", limit: 100 });
        expect(r.body["query_tokens"]).toBe(2);
        expect(r.body["best_coverage"]).toBe(2);
      });

      it("leaves the order and the match count as the adapter ranked them", async () => {
        const adapter: { search(q: string): Promise<Array<{ id: string }>> } = adapters[surface];
        const ranked = (await adapter.search(WEAK)).map((x) => x.id);
        const r = await call(tool, { query: WEAK, limit: 100 });
        expect(r.body["results"].map((x: { id: string }) => x.id)).toEqual(ranked);
        expect(r.body["total_matches"]).toBe(ranked.length);
      });

      it("does not decorate detail: 'full' records, but the envelope still carries the figures", async () => {
        const r = await call(tool, { query: WEAK, limit: 3, detail: "full" });
        expect(r.isError).toBe(false);
        for (const row of r.body["results"]) expect("coverage" in row).toBe(false);
        expect(r.body["query_tokens"]).toBe(9);
        expect(r.body["best_coverage"]).toBe(4);
        expect(r.body["notice"]).toContain(weakMatchNotice(4, 9));
      });

      it("a query nothing matches has no best_coverage and no weak notice", async () => {
        const r = await call(tool, { query: "qqqone qqqtwo", limit: 100 });
        expect(r.body["total_matches"]).toBe(0);
        expect(r.body["query_tokens"]).toBe(2);
        expect("best_coverage" in r.body).toBe(false);
        expect(r.body["notice"]).toBeUndefined();
      });

      it("handles the empty and one-character queries as before", async () => {
        const blank = await call(tool, { query: "  " });
        expect(blank.isError).toBe(false);
        expect(blank.body["results"]).toEqual([]);
        expect(blank.body["total_matches"]).toBe(0);
        expect(blank.body["query_tokens"]).toBe(0);
        expect("best_coverage" in blank.body).toBe(false);
        expect(blank.body["notice"]).toBeUndefined();
        const one = await call(tool, { query: "a" });
        expect(one.isError).toBe(true); // rejected by the input schema, as ever
      });

      it("costs a concise page of 20 only a few hundred characters", async () => {
        // Same rows without the new keys: the growth is what the new fields add.
        const r = await call(tool, { query: WEAK, limit: 20 });
        const withFields = r.text.length;
        const stripped = JSON.parse(r.text);
        for (const row of stripped.results) delete row.coverage;
        delete stripped.query_tokens;
        delete stripped.best_coverage;
        delete stripped.notice;
        const growth = withFields - serialize(stripped).length;
        expect(growth).toBeGreaterThan(0);
        expect(growth).toBeLessThan(600);
      });
    });
  }

  it("search_regulation keeps its excerpts alongside the coverage", async () => {
    const r = await call("search_regulation", { query: STRONG, limit: 1 });
    const row = r.body["results"][0];
    expect(row.coverage).toBe(4);
    expect(row.matched_excerpt).toContain("alpha beta gamma delta");
  });
});

describe("withQueryCoverage", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: i, text: "x".repeat(1_000) }));

  it("appends to a shortening notice instead of overwriting it", () => {
    const env = paginate(rows, 40, 0, 5_000);
    expect(env.notice).toContain("shortened");
    const out = withQueryCoverage(env, 6, 2);
    expect(out.notice?.startsWith(env.notice!)).toBe(true);
    expect(out.notice).toContain(weakMatchNotice(2, 6));
    expect(out.results).toBe(env.results);
    expect(out.total_matches).toBe(40);
  });

  it("never raises the notice for a single-term query, whatever the coverage", () => {
    for (const best of [0, 1]) {
      expect(withQueryCoverage(paginate(rows, 5, 0), 1, best).notice).toBe(paginate(rows, 5, 0).notice!);
    }
    expect(withQueryCoverage(paginate(rows, 5, 0), 1, 0).best_coverage).toBe(0);
  });

  it("adds no notice when the best match is not weak, and none when nothing matched", () => {
    expect(withQueryCoverage(paginate(rows, 5, 0), 4, 2).notice).toBe(paginate(rows, 5, 0).notice!);
    const none = withQueryCoverage(paginate([], 5, 0), 4, undefined);
    expect(none.notice).toBeUndefined();
    expect("best_coverage" in none).toBe(false);
    expect(none.query_tokens).toBe(4);
  });
});

describe("distinctQueryTokens", () => {
  it("excludes stopwords exactly as ranking does, and counts repeats once", () => {
    expect(distinctQueryTokens("margin of conservatism")).toBe(2);
    expect(distinctQueryTokens("rate rate rate")).toBe(1);
    expect(distinctQueryTokens("   ")).toBe(0);
    // A legal point segment is one character and still a term.
    expect(distinctQueryTokens("article 180 1 a")).toBe(3);
  });
});
