import { describe, expect, it } from "bun:test";

import {
  checkSearchFields,
  rankedSearch,
  regulationSearchFields,
  tokenize,
  type SearchField,
} from "../src/search.ts";
import type { Check, Regulation } from "../src/schema.ts";

// ── rankedSearch — the one ranking definition every adapter shares ─────────────
//
// The old JSON.stringify substring scan matched keys and URIs (query
// "regulation" hit 100% of records) and dumped the whole corpus on "".
// These tests pin the replacement contract.

const check = (id: string, name: string, expectation: string, evidence: string[] = []): Check => ({
  id: id as Check["id"],
  name,
  derived_from: [],
  expectation,
  expected_evidence: evidence,
  last_updated: "2026-01-01",
});

const regulation = (id: string, citation: string, text: string): Regulation => ({
  id: id as Regulation["id"],
  framework: "crr",
  document_id: "crr",
  document_version: "2024-01-09",
  citation,
  text,
  commentary: [],
  children: [],
});

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, drops empties and stopwords", () => {
    expect(tokenize("Long-Run  Average (LRA)!")).toEqual(["long", "run", "average", "lra"]);
    // "a" is a stopword and goes; the digit segments stay, because a citation's
    // article and paragraph numbers are the whole point of a URI-shaped query.
    expect(tokenize("regulation://crr/180/1/a")).toEqual(["regulation", "crr", "180", "1"]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });

  it("drops stopwords, which is what stops them dominating coverage", () => {
    // "of" used to be scored, and it substring-matches almost immediately in
    // any English text — so every record earned a free point of coverage, the
    // primary sort key, and the excerpt window pinned to the head of the text.
    expect(tokenize("margin of conservatism")).toEqual(["margin", "conservatism"]);
    expect(tokenize("the of and to")).toEqual(["the", "of", "and", "to"]); // all-stopword: falls back
  });
});

describe("rankedSearch", () => {
  it("returns [] for an empty or whitespace-only query — enumeration is list()'s job", () => {
    const items = [check("check://a/b", "Anything", "Anything at all.")];
    expect(rankedSearch(items, "", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "   \t ", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "()[]", checkSearchFields)).toEqual([]); // punctuation-only tokenizes to nothing
  });

  it("field weights order results: a name match outranks an expected_evidence match", () => {
    const evidenceOnly = check("check://a/evidence", "Unrelated title", "Unrelated bar.", [
      "calibration workbook per grade",
    ]);
    const nameHit = check("check://a/name", "Calibration tested per grade", "Unrelated bar.");
    // Input order deliberately puts the weaker match first.
    const results = rankedSearch([evidenceOnly, nameHit], "calibration", checkSearchFields);
    expect(results.map((m) => m.record.id)).toEqual(["check://a/name", "check://a/evidence"]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("a whole-word occurrence outranks a substring-only occurrence at equal weight", () => {
    const wholeWord = check("check://w/whole", "The calibration check", "x.");
    const substringOnly = check("check://w/sub", "The recalibrations check", "x.");
    const results = rankedSearch([substringOnly, wholeWord], "calibration", checkSearchFields);
    expect(results.map((m) => m.record.id)).toEqual(["check://w/whole", "check://w/sub"]);
    expect(results[0]!.score).toBe(4 * results[1]!.score); // substring counts a quarter

    // And only the whole-word match establishes coverage: a record that merely
    // contains the letters must not tie on the primary sort key.
    expect(results[0]!.coverage).toBe(1);
    expect(results[1]!.coverage).toBe(0);
  });

  it("ties break by input order, so ranking is fully deterministic", () => {
    const a = check("check://t/a", "Calibration one", "x.");
    const b = check("check://t/b", "Calibration two", "x.");
    expect(rankedSearch([a, b], "calibration", checkSearchFields).map((m) => m.record.id)).toEqual([
      "check://t/a",
      "check://t/b",
    ]);
    expect(rankedSearch([b, a], "calibration", checkSearchFields).map((m) => m.record.id)).toEqual([
      "check://t/b",
      "check://t/a",
    ]);
  });

  it("ranks everything by default and honours an explicit limit", () => {
    const many = Array.from({ length: 25 }, (_, i) => check(`check://cap/${i}`, "Calibration", "x."));
    // Uncapped: this used to slice to 20 before the tool layer counted, which
    // made total_matches report a page size on every query of every surface.
    // Paging is the tool layer's job; ranking returns everything it ranked.
    expect(rankedSearch(many, "calibration", checkSearchFields)).toHaveLength(25);
    expect(rankedSearch(many, "calibration", checkSearchFields, 3)).toHaveLength(3);
  });

  it("non-matching queries return [] — no key/URI leakage from the old stringify scan", () => {
    const items = [check("check://a/b", "Calibration", "Bar.")];
    // "expectation" and "last" are field NAMES, not values — must not match.
    expect(rankedSearch(items, "expectation", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "zzz-no-such-token", checkSearchFields)).toEqual([]);
  });

  it("each match carries the best-scoring field name and an excerpt", () => {
    const short = check("check://e/short", "Calibration", "Short text.");
    const [m] = rankedSearch([short], "calibration", checkSearchFields);
    expect(m!.matched.field).toBe("name");
    expect(m!.matched.excerpt).toBe("Calibration"); // short values excerpt whole

    const longText = `${"Padding sentence. ".repeat(20)}The calibration target sits here.${" More padding.".repeat(20)}`;
    const long = check("check://e/long", "Unrelated", longText);
    const [ml] = rankedSearch([long], "calibration", checkSearchFields);
    expect(ml!.matched.field).toBe("expectation");
    expect(ml!.matched.excerpt).toContain("calibration");
    // 340-char window + up to 220 chars of sentence snap at each end + ellipses.
    expect(ml!.matched.excerpt.length).toBeLessThanOrEqual(782);
    expect(ml!.matched.excerpt.startsWith("…")).toBe(true);

    // The window centres on the match rather than the head of the text, and is
    // wide enough to carry the clause — an excerpt that cannot be quoted is a
    // pointer, and forces a second call to open the record.
    expect(ml!.matched.excerpt).toContain("The calibration target sits here.");

    // It also STARTS and ENDS on sentence boundaries. This is the difference
    // between context and a pointer: an excerpt cut mid-clause cannot be quoted
    // or reasoned from, so the caller opens the full record anyway and the
    // excerpt has cost tokens for nothing.
    const body = ml!.matched.excerpt.replace(/^…/, "").replace(/…$/, "");
    expect(body).toMatch(/[.!?]$/);
    expect(body[0]).toBe(body[0]!.toUpperCase());
  });

  it("reports the source field's length, so truncation is derivable from the record", () => {
    // NOT from the ellipsis: the markers are a decoration makeExcerpt controls,
    // so a check that infers "was this cut?" from them can be satisfied by
    // deleting two characters without changing a single excerpt.
    const short = check("check://e/chars", "Calibration", "Short text.");
    const [m] = rankedSearch([short], "calibration", checkSearchFields);
    expect(m!.matched.field_chars).toBe("Calibration".length);

    const longText = `${"Padding sentence. ".repeat(20)}The calibration target sits here.`;
    const [ml] = rankedSearch([check("check://e/c2", "Unrelated", longText)], "calibration", checkSearchFields);
    expect(ml!.matched.field_chars).toBe(longText.length);
    expect(ml!.matched.excerpt.length).toBeLessThan(ml!.matched.field_chars);
  });

  it("a sentence longer than the budget is cut at an enumeration point, not mid-clause", () => {
    // A legal instrument numbers its obligations "(a) …; (b) …;" with no
    // sentence terminator until the end, so the whole paragraph is one span and
    // the excerpt falls into the bounded-window fallback. Ending it wherever the
    // character count ran out is what made ~44% of regulation hits unquotable.
    const limb = (n: string, filler: string) => `(${n}) institutions shall ${filler} for the purposes of this paragraph; `;
    const para =
      "1. In quantifying the risk parameters institutions shall apply the following requirements: " +
      limb("a", "estimate the long run average of realised outcomes") +
      limb("b", "apply a calibration target appropriate to a downturn") +
      limb("c", "include an additional margin of conservatism") +
      limb("d", "document every assumption relied upon");
    const [m] = rankedSearch([regulation("regulation://x/1", "Article 1", para)], "calibration", regulationSearchFields("calibration"));
    const body = m!.matched.excerpt.replace(/^…/, "").replace(/…$/, "").trim();

    expect(body).toContain("calibration");
    expect(body).toMatch(/[.!?;]$/); // a statement end — ";" ends a point
    expect(body.endsWith(":")).toBe(false); // a colon promises a list it lacks

    // And it never BEGINS on an orphaned limb: "(c) include an additional
    // margin of conservatism" without its chapeau has lost the addressee and
    // the trigger, which is the same defect class as a confident wrong citation.
    expect(body).not.toMatch(/^\s*\(?[a-z0-9]{1,3}\)/i);
  });
});

// ── regulationSearchFields — the id field is query-shape dependent ─────────────

describe("coverage — how many of the query's tokens a record matched", () => {
  // The defect: score is a SUM over tokens, so a record matching only the
  // commonest token could outrank one matching every token. On the real corpus
  // "long run average default rate" matched 707 of 1,365 regulation records and
  // "margin of conservatism data quality" matched 984 of 1,107 checks, because
  // everything says "data" somewhere — and search_playbooks("PD model
  // lifecycle") put the one playbook actually about the lifecycle FOURTH.

  it("reports coverage and the query's token count on every match", () => {
    const hits = rankedSearch(
      [check("check://a", "downturn calibration", "")],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(2);
    expect(hits[0]!.query_tokens).toBe(2);
  });

  it("ranks a record matching every token above one matching fewer at a HIGHER score", () => {
    // `narrow` matches both tokens once. `broad` matches only "model", but
    // eight times, so the old sum put it first.
    const narrow = check("check://narrow", "model lifecycle", "");
    const broad = check("check://broad", "model model model model model model model model", "");
    const hits = rankedSearch([broad, narrow], "model lifecycle", checkSearchFields);

    expect(hits[0]!.record.id).toBe("check://narrow");
    expect(hits[0]!.coverage).toBe(2);
    // Pinning that this is coverage doing the work, not score: the loser
    // genuinely scores higher.
    expect(hits[1]!.score).toBeGreaterThan(hits[0]!.score);
  });

  it("falls back to score within one coverage tier", () => {
    const strong = check("check://strong", "downturn downturn calibration", "");
    const weak = check("check://weak", "downturn calibration", "");
    const hits = rankedSearch([weak, strong], "downturn calibration", checkSearchFields);
    expect(hits.map((h) => h.coverage)).toEqual([2, 2]);
    expect(hits[0]!.record.id).toBe("check://strong");
  });

  it("counts a token once per record however many fields carry it", () => {
    // Coverage is "did this record match the token at all", not a tally.
    const hits = rankedSearch(
      [check("check://both", "downturn", "downturn", ["downturn"])],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(1);
    expect(hits[0]!.query_tokens).toBe(2);
  });

  it("counts a token matched in a DIFFERENT field from its neighbour", () => {
    // "downturn" in the name and "calibration" only in the evidence is still
    // full coverage — the record is about both.
    const hits = rankedSearch(
      [check("check://split", "downturn", "", ["calibration evidence"])],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(2);
  });

  it("leaves single-token queries exactly as they were", () => {
    // Coverage is 1 for every match, so ordering falls straight through to
    // score. This is what makes the change safe for the common case.
    const items = [
      check("check://one", "downturn", ""),
      check("check://three", "downturn downturn downturn", ""),
      check("check://two", "downturn downturn", ""),
    ];
    const hits = rankedSearch(items, "downturn", checkSearchFields);
    expect(hits.map((h) => h.coverage)).toEqual([1, 1, 1]);
    expect(hits.map((h) => h.record.id)).toEqual([
      "check://three",
      "check://two",
      "check://one",
    ]);
    // And score is still strictly decreasing — coverage did not reorder it.
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it("still drops records matching no token at all", () => {
    const hits = rankedSearch(
      [check("check://a", "downturn", "")],
      "unrelated words entirely",
      checkSearchFields,
    );
    expect(hits).toEqual([]);
  });

  it("keeps ties deterministic by input order at equal coverage and score", () => {
    const items = [
      check("check://first", "downturn calibration", ""),
      check("check://second", "downturn calibration", ""),
    ];
    expect(rankedSearch(items, "downturn calibration", checkSearchFields).map((h) => h.record.id))
      .toEqual(["check://first", "check://second"]);
  });
});

describe("regulationSearchFields", () => {
  const regs = [
    regulation("regulation://crr/180", "CRR Article 180", "PD estimation requirements."),
    regulation("regulation://crr/178/1/a", "CRR Article 178(1)(a)", "Unlikeliness to pay."),
  ];

  it("URI-ish queries match on id", () => {
    const hits = rankedSearch(regs, "crr/180", regulationSearchFields("crr/180"));
    expect(hits.map((m) => m.record.id)).toContain("regulation://crr/180");
    const full = rankedSearch(regs, "regulation://crr/178/1/a", regulationSearchFields("regulation://crr/178/1/a"));
    expect(full[0]!.record.id).toBe("regulation://crr/178/1/a");
  });

  it("prose queries never match through the URI scheme — 'regulation' no longer hits 100% of records", () => {
    // Every id contains "regulation", but no citation/text/commentary does.
    expect(rankedSearch(regs, "regulation", regulationSearchFields("regulation"))).toEqual([]);
  });

  it("prose queries still match citation ahead of text", () => {
    const hits = rankedSearch(regs, "article 178", regulationSearchFields("article 178"));
    expect(hits[0]!.record.id).toBe("regulation://crr/178/1/a");
    expect(hits[0]!.matched.field).toBe("citation");
  });
});

// ── array-valued fields ─────────────────────────────────────────────────────────

describe("array-valued search fields", () => {
  it("scans every value and anchors the excerpt on the first matching one", () => {
    const fields: SearchField<{ tags: string[] }>[] = [
      { name: "tags", weight: 1, get: (r) => r.tags },
    ];
    const [m] = rankedSearch([{ tags: ["nothing here", "jeffreys prior", "jeffreys again"] }], "jeffreys", fields);
    expect(m!.score).toBe(2); // one whole-word occurrence per value
    expect(m!.matched.excerpt).toBe("jeffreys prior");
  });
});
