import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";

import {
  createFileAdapters,
  loadCorpusFile,
  resolveCitationDetailed,
  resolveCitationIn,
} from "../src/file-adapter.ts";
import type { Regulation } from "../src/schema.ts";

// The load path deserves a real file: loadCorpusFile is readFileSync + JSON +
// zod, and everything downstream (MCPB entry, CORPUS_FILE validation runs)
// goes through it. Fixtures are written to a per-run temp dir.
const dir = mkdtempSync(join(tmpdir(), "prudent-corpus-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeCorpus(name: string, corpus: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(corpus, null, 2));
  return path;
}

// A small but fully populated five-surface corpus. Source `verified` dates sit
// far in the past so staleness is deterministic without an injectable clock
// (meta.info() uses the wall clock): the current source is always stale, and
// the superseded/pending ones are never flagged regardless of the run date.
const fullCorpus = {
  regulation: [
    {
      id: "regulation://crr/1",
      framework: "crr",
      document_id: "crr",
      document_version: "2024-01-09",
      citation: "CRR Art. 1",
      text: "Scope of application of the prudential perimeter.",
      children: ["check://scope/entities"],
    },
    {
      id: "regulation://eba/gl-x/1",
      framework: "eba",
      document_id: "eba-gl-x",
      document_version: "2020-01-01",
      citation: "EBA GL X para 1",
      text: "Calibration testing expectations.",
    },
  ],
  tests: [
    {
      id: "test://binomial",
      name: "Binomial test",
      purpose: "One-sided calibration back-test per grade.",
      regulatory_basis: ["regulation://eba/gl-x/1"],
      last_updated: "2026-08-01",
    },
  ],
  checks: [
    {
      id: "check://scope/entities",
      name: "Perimeter completeness",
      derived_from: ["regulation://crr/1"],
      parent: "regulation://crr/1",
      expectation: "Every in-scope entity is covered by the model landscape.",
      expected_evidence: ["Entity perimeter list"],
      last_updated: "2026-08-01",
    },
  ],
  playbooks: [
    {
      id: "playbook://scope/review",
      area: "scope",
      phases: [
        {
          name: "Phase 1",
          description: "Establish the perimeter.",
          references: ["regulation://crr/1", "check://scope/entities"],
        },
      ],
      regulatory_scope: ["regulation://crr/1"],
      last_updated: "2026-08-01",
    },
  ],
  sources: [
    {
      id: "source://crr/crr",
      title: "Capital Requirements Regulation",
      framework: "crr",
      document_id: "crr",
      doc_type: "regulation",
      status: "current",
      verified: "2020-01-01", // always older than STALE_AFTER_DAYS → always stale
    },
    {
      id: "source://eba/gl-old",
      title: "Old guidelines",
      framework: "eba",
      document_id: "eba-gl-old",
      doc_type: "guideline",
      status: "superseded",
      superseded_by: "source://crr/crr",
      verified: "2020-01-01", // equally old, but never flagged: not current
    },
    {
      id: "source://eba/cp-x",
      title: "Consultation paper X",
      framework: "eba",
      document_id: "eba-cp-x",
      doc_type: "consultation",
      status: "pending",
      verified: "2020-01-01", // equally old, but never flagged: not current
    },
  ],
  taxonomy: [{ id: "scope", name: "Scope" }],
  // Stored corpus_info in the pre-sources 4-key shape: no `source` count, no
  // stale_sources. counts.regulation is deliberately wrong (42) to prove the
  // serve-time overlay replaces ONLY counts.source and stale_sources — stored
  // values pass through otherwise.
  corpus_info: {
    last_updated: "2026-08-01T00:00:00.000Z",
    counts: { regulation: 42, test: 1, check: 1, playbook: 1 },
    coverage: ["CRR", "EBA-GL-X"],
  },
};

describe("loadCorpusFile", () => {
  it("parses a full five-surface corpus from disk", () => {
    const corpus = loadCorpusFile(writeCorpus("full.json", fullCorpus));
    expect(corpus.regulation.map((r) => r.id)).toEqual(["regulation://crr/1", "regulation://eba/gl-x/1"]);
    expect(corpus.tests).toHaveLength(1);
    expect(corpus.checks).toHaveLength(1);
    expect(corpus.playbooks).toHaveLength(1);
    expect(corpus.sources).toHaveLength(3);
    expect(corpus.taxonomy.map((a) => a.id)).toEqual(["scope"]);
    // zod defaults applied inside records too
    expect(corpus.regulation[1]!.children).toEqual([]);
    expect(corpus.tests[0]!.aliases).toEqual([]);
  });

  it("fills defaults for missing surface keys (sources/taxonomy absent → [])", () => {
    const corpus = loadCorpusFile(
      writeCorpus("minimal.json", { regulation: [fullCorpus.regulation[0]] }),
    );
    expect(corpus.regulation).toHaveLength(1);
    expect(corpus.tests).toEqual([]);
    expect(corpus.checks).toEqual([]);
    expect(corpus.playbooks).toEqual([]);
    expect(corpus.sources).toEqual([]);
    expect(corpus.taxonomy).toEqual([]);
    expect(corpus.corpus_info).toBeUndefined();
  });

  it("accepts a stored corpus_info block with pre-sources 4-key counts", () => {
    const corpus = loadCorpusFile(writeCorpus("full.json", fullCorpus));
    expect(corpus.corpus_info).toBeDefined();
    expect(corpus.corpus_info!.counts.source).toBeUndefined();
    // stale_sources defaults to [] so old stored blocks stay parseable
    expect(corpus.corpus_info!.stale_sources).toEqual([]);
  });

  it("throws a ZodError on a malformed record (regulation with a test:// id)", () => {
    const path = writeCorpus("malformed.json", {
      regulation: [{ ...fullCorpus.regulation[0], id: "test://not-a-regulation" }],
    });
    expect(() => loadCorpusFile(path)).toThrow(ZodError);
  });
});

describe("createFileAdapters", () => {
  const adapters = createFileAdapters(loadCorpusFile(writeCorpus("adapters.json", fullCorpus)));

  it("get round-trips every content surface and misses cleanly", async () => {
    const regHit = await adapters.regulation.get("regulation://crr/1");
    expect(regHit?.citation).toBe("CRR Art. 1");
    expect(await adapters.regulation.get("regulation://nope")).toBeNull();

    const testHit = await adapters.test.get("test://binomial");
    expect(testHit?.name).toBe("Binomial test");
    expect(await adapters.test.get("test://nope")).toBeNull();

    const checkHit = await adapters.check.get("check://scope/entities");
    expect(checkHit?.expected_evidence).toEqual(["Entity perimeter list"]);
    expect(await adapters.check.get("check://nope/nope")).toBeNull();

    const playbookHit = await adapters.playbook.get("playbook://scope/review");
    expect(playbookHit?.phases[0]?.references).toContain("check://scope/entities");
    expect(await adapters.playbook.get("playbook://nope")).toBeNull();

    const sourceHit = await adapters.source.get("source://eba/gl-old");
    expect(sourceHit?.superseded_by).toBe("source://crr/crr");
    expect(await adapters.source.get("source://eba/nope")).toBeNull();
  });

  it("search matches record text case-insensitively and misses cleanly", async () => {
    expect((await adapters.regulation.search("PRUDENTIAL perimeter")).map((r) => r.id)).toEqual([
      "regulation://crr/1",
    ]);
    expect((await adapters.test.search("binomial")).map((t) => t.id)).toEqual(["test://binomial"]);
    expect((await adapters.check.search("perimeter list")).map((c) => c.id)).toEqual([
      "check://scope/entities",
    ]);
    expect((await adapters.playbook.search("establish the perimeter")).map((p) => p.id)).toEqual([
      "playbook://scope/review",
    ]);
    expect(await adapters.regulation.search("zzz-no-such-token")).toEqual([]);
  });

  it("source list returns everything unfiltered and filters by status", async () => {
    expect((await adapters.source.list()).map((s) => s.id)).toEqual([
      "source://crr/crr",
      "source://eba/gl-old",
      "source://eba/cp-x",
    ]);
    expect((await adapters.source.list({ status: "current" })).map((s) => s.id)).toEqual([
      "source://crr/crr",
    ]);
    expect((await adapters.source.list({ status: "superseded" })).map((s) => s.id)).toEqual([
      "source://eba/gl-old",
    ]);
    expect((await adapters.source.list({ status: "pending" })).map((s) => s.id)).toEqual([
      "source://eba/cp-x",
    ]);
  });

  it("meta.info() overlays computed counts.source and stale_sources on a stored corpus_info", async () => {
    const info = await adapters.meta.info();
    // Stored values pass through untouched — including the deliberately wrong
    // regulation count, proving the overlay is surgical.
    expect(info.last_updated).toBe("2026-08-01T00:00:00.000Z");
    expect(info.coverage).toEqual(["CRR", "EBA-GL-X"]);
    expect(info.counts.regulation).toBe(42);
    // …while source count and staleness are computed at serve time.
    expect(info.counts.source).toBe(3);
    expect(info.stale_sources).toEqual(["source://crr/crr"]);
  });

  it("meta.info() computes everything when the file ships no corpus_info", async () => {
    const bare = createFileAdapters(
      loadCorpusFile(writeCorpus("bare.json", { regulation: fullCorpus.regulation })),
    );
    const info = await bare.meta.info();
    expect(info.counts).toEqual({ regulation: 2, test: 0, check: 0, playbook: 0, source: 0 });
    expect(info.coverage).toEqual(["CRR", "EBA"]);
    expect(info.stale_sources).toEqual([]);
    expect(Number.isNaN(Date.parse(info.last_updated))).toBe(false);
  });

  it("meta.referrers scans playbook phase references, not just regulatory_scope", async () => {
    // The check appears ONLY inside a phase's references array — the old scan
    // (regulatory_scope only) returned playbooks: [] here.
    const checkRefs = await adapters.meta.referrers("check://scope/entities");
    expect(checkRefs.playbooks).toEqual(["playbook://scope/review"]);
    // Structural referrer: the regulation that lists the check as a child.
    expect(checkRefs.regulation).toEqual(["regulation://crr/1"]);
    expect(checkRefs.tests).toEqual([]);
    expect(checkRefs.checks).toEqual([]);
  });

  it("meta.referrers on a regulation covers checks, playbooks, and structure", async () => {
    const refs = await adapters.meta.referrers("regulation://crr/1");
    expect(refs.checks).toEqual(["check://scope/entities"]);
    expect(refs.playbooks).toEqual(["playbook://scope/review"]); // scope + phase reference
    expect(refs.regulation).toEqual([]);
  });
});

// ── as_of resolution against regulation_history ────────────────────────────────
//
// The documented rule: no asOf → current; asOf with no history for the id →
// current (the only version the corpus knows); asOf with history → the last
// entry with effective_from <= asOf, or null when asOf predates every entry.
// Current text is selectable under asOf only via a current-boundary entry.

describe("regulation.get(id, asOf) with regulation_history", () => {
  const currentText = "Materiality assessed against thresholds set in the relevant RTS.";
  const oldText = "Materiality is left to national competent authority discretion.";
  const versioned = {
    id: "regulation://crr/178/1/b",
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 178(1)(b)",
    text: currentText,
  };
  const historyCorpus = {
    regulation: [versioned, ...fullCorpus.regulation],
    regulation_history: [
      // Deliberately out of order in the file — the adapter must sort.
      {
        id: "regulation://crr/178/1/b",
        effective_from: "2021-06-28",
        record: versioned, // current-boundary entry: makes the current version as_of-selectable
      },
      {
        id: "regulation://crr/178/1/b",
        effective_from: "2014-01-01",
        record: { ...versioned, document_version: "2013-06-26", text: oldText },
      },
    ],
  };
  const fa = createFileAdapters(loadCorpusFile(writeCorpus("history.json", historyCorpus)));

  it("no asOf serves the current record", async () => {
    const r = await fa.regulation.get("regulation://crr/178/1/b");
    expect(r?.text).toBe(currentText);
  });

  it("asOf between versions serves the version then in force — not current text as historical", async () => {
    const r = await fa.regulation.get("regulation://crr/178/1/b", "2015-06-01");
    expect(r?.document_version).toBe("2013-06-26");
    expect(r?.text).toBe(oldText);
  });

  it("asOf equal to an effective_from boundary selects that entry (inclusive)", async () => {
    const atOld = await fa.regulation.get("regulation://crr/178/1/b", "2014-01-01");
    expect(atOld?.document_version).toBe("2013-06-26");
    const atCurrent = await fa.regulation.get("regulation://crr/178/1/b", "2021-06-28");
    expect(atCurrent?.text).toBe(currentText);
  });

  it("asOf after every entry serves the latest history entry", async () => {
    const r = await fa.regulation.get("regulation://crr/178/1/b", "2030-01-01");
    expect(r?.text).toBe(currentText);
  });

  it("asOf predating every recorded version is null — never current text masquerading", async () => {
    expect(await fa.regulation.get("regulation://crr/178/1/b", "2010-01-01")).toBeNull();
  });

  it("asOf on an id without history serves the only version the corpus knows", async () => {
    const r = await fa.regulation.get("regulation://crr/1", "1999-01-01");
    expect(r?.citation).toBe("CRR Art. 1");
  });

  it("asOf on an unknown id is null", async () => {
    expect(await fa.regulation.get("regulation://nope", "2020-01-01")).toBeNull();
  });

  it("corpora without regulation_history behave exactly as before", async () => {
    const plain = createFileAdapters(loadCorpusFile(writeCorpus("no-history.json", fullCorpus)));
    const r = await plain.regulation.get("regulation://crr/1", "1999-01-01");
    expect(r?.citation).toBe("CRR Art. 1");
  });
});

// ── resolveCitationDetailed — the deterministic citation matcher ──────────────
//
// The bar is honesty before recall: a citation this corpus cannot place must
// come back as null WITH a reason, never as the nearest-numbered provision.

describe("resolveCitationDetailed", () => {
  const cite = (id: string, citation: string, documentId = "crr"): Regulation => ({
    id: id as Regulation["id"],
    framework: id.slice("regulation://".length).split("/")[0]!,
    document_id: documentId,
    document_version: "2024-01-09",
    citation,
    text: "…",
    commentary: [],
    children: [],
  });
  const regs = [
    cite("regulation://crr/178/1/a", "CRR Article 178(1)(a)"),
    cite("regulation://crr/178/1/b", "CRR Article 178(1)(b)"),
    cite("regulation://crr/180", "CRR Article 180"),
    cite("regulation://crr/180/1/a", "CRR Article 180(1)(a)"),
    cite("regulation://eba/gl-2017-16/78", "EBA GL 2017/16 paragraph 78", "eba-gl-2017-16"),
  ];

  it("resolves an exact citation and says the match was exact", () => {
    const r = resolveCitationDetailed(regs, "Art. 178(1)(a)");
    expect(r.match?.id).toBe("regulation://crr/178/1/a");
    expect(r.confidence).toBe("exact");
    expect(r.ambiguous).toBe(false);
  });

  it("resolves a citation whose document is named in prose", () => {
    expect(resolveCitationDetailed(regs, "CRR Article 180").match?.id).toBe("regulation://crr/180");
    expect(resolveCitationDetailed(regs, "EBA GL 2017/16 para 78").match?.id).toBe(
      "regulation://eba/gl-2017-16/78",
    );
  });

  it("strips the document's own numbers before comparing the spine", () => {
    // "2017" and "16" name the document, not the provision. Scored as part of
    // the spine they make it ["2017","16","78"], which matches nothing — and a
    // resolver that then falls through to a looser rule is how fabrication
    // starts.
    const r = resolveCitationDetailed(regs, "paragraph 78 of eba-gl-2017-16");
    expect(r.match?.id).toBe("regulation://eba/gl-2017-16/78");
    expect(r.confidence).toBe("segment");
  });

  it("declines a citation naming a node the corpus does not hold, and names the relatives", () => {
    // No regulation://crr/178 record exists. The old resolver answered this
    // with 178(1)(a) — a different provision, presented as the one asked for.
    const r = resolveCitationDetailed(regs, "CRR Article 178");
    expect(r.match).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual([
      "regulation://crr/178/1/a",
      "regulation://crr/178/1/b",
    ]);
    expect(r.coverage_note).toContain("narrower");
  });

  it("declines a near-number instead of resolving it by containment", () => {
    // "1218" contains "121"; normalized containment used to make that a hit.
    const r = resolveCitationDetailed(regs, "CRR Article 1808");
    expect(r.match).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.unmatched_segments).toEqual(["1808"]);
  });

  it("declines a citation into an instrument the corpus does not hold", () => {
    const eba = [regs[4]!];
    const r = resolveCitationDetailed(eba, "Article 178 of the CRR");
    expect(r.match).toBeNull();
    expect(r.coverage_note).toContain("CRR");
    const foreign = resolveCitationDetailed(regs, "Article 1 of Regulation (EU) No 9999/9999");
    expect(foreign.match).toBeNull();
    expect(foreign.coverage_note).toContain("9999/9999");
  });

  it("sees post-2015 EU numbering, and cites each era the way it is written", () => {
    // Acts were numbered serial/YEAR until 2015 and YEAR/serial after it. A gate
    // requiring a four-digit SECOND number is blind to every act adopted since,
    // and the miss then falls through to the numeric spine rules — which is how
    // asking for a real instrument came back "nothing is numbered 2021.930",
    // a malformed-citation shape rather than a coverage boundary.
    const modern = resolveCitationDetailed(regs, "Commission Delegated Regulation (EU) 2021/930");
    expect(modern.match).toBeNull();
    expect(modern.coverage_note).toContain("holds no Regulation (EU) 2021/930");
    // And never the pre-2015 "No" on a post-2015 act: that is a wrong citation
    // of a real instrument, emitted by the one path whose job is not guessing.
    expect(modern.coverage_note).not.toContain("No 2021/930");

    const legacy = resolveCitationDetailed(regs, "Article 5 of Regulation (EU) No 1093/2010");
    expect(legacy.match).toBeNull();
    expect(legacy.coverage_note).toContain("Regulation (EU) No 1093/2010");
  });

  it("names the CONTAINING provision when the corpus is coarser than the citation", () => {
    // The mirror of the narrower-relatives rule. The CRR is stored at whole-
    // article granularity while most cross-references to it are bracketed
    // sub-article points, so "Article 180(1)(b)" — a point served verbatim
    // inside Article 180 — used to come back as a bare miss.
    const r = resolveCitationDetailed(regs, "CRR Article 180(1)(b)");
    expect(r.match).toBeNull(); // still a decline: matching is not loosened
    expect(r.confidence).toBe("none");
    expect(r.candidates.map((c) => c.id)).toContain("regulation://crr/180");
    expect(r.coverage_note).toContain("Article 180");

    // The NARROWEST container is offered first: 180(1)(a) is held, so a point
    // under it leads with that rather than with the whole article.
    const deeper = resolveCitationDetailed(regs, "CRR Article 180(1)(a)(2)");
    expect(deeper.match).toBeNull();
    expect(deeper.candidates.map((c) => c.id)).toEqual([
      "regulation://crr/180/1/a",
      "regulation://crr/180",
    ]);
  });

  it("a record whose citation carries no numbers contains nothing", () => {
    // Without the guard an unnumbered record is a prefix of every spine, so it
    // would claim to contain every citation in the corpus.
    const withPreamble = [...regs, cite("regulation://crr/preamble", "Preamble")];
    const r = resolveCitationDetailed(withPreamble, "CRR Article 999(1)");
    expect(r.match).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.coverage_note).toContain("Nothing in this corpus is numbered");
  });

  it("reports ambiguity across documents rather than picking one", () => {
    const twoDocs = [
      cite("regulation://gl-2017-16/article-78", "Article 78", "eba-gl-2017-16"),
      cite("regulation://gl-2019-03/article-78", "Article 78", "eba-gl-2019-03"),
    ];
    const r = resolveCitationDetailed(twoDocs, "Article 78");
    expect(r.match).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
    expect(r.coverage_note).toContain("2 document");
    // Naming the document disambiguates without any change to the citation.
    expect(resolveCitationDetailed(twoDocs, "eba-gl-2019-03 Article 78").match?.id).toBe(
      "regulation://gl-2019-03/article-78",
    );
  });

  it("matches a spine spelled with structural words the record does not use", () => {
    const egim = [cite("regulation://egim/article-5.12", "Chapter 5, paragraph 12", "egim")];
    expect(resolveCitationDetailed(egim, "EGIM chapter 5 paragraph 12").match?.id).toBe(
      "regulation://egim/article-5.12",
    );
    expect(resolveCitationDetailed(egim, "egim 5.12").match?.id).toBe(
      "regulation://egim/article-5.12",
    );
  });

  it("returns null for prose that names nothing in the corpus", () => {
    expect(resolveCitationDetailed(regs, "the general spirit of prudence").match).toBeNull();
    expect(resolveCitationDetailed(regs, "").match).toBeNull();
    expect(resolveCitationIn(regs, "the general spirit of prudence")).toBeNull();
  });

  it("matches a declared alias, and says the record's own citation differs", () => {
    // EBA guidelines number PARAGRAPHS, and their range sits inside the CRR's
    // article range — so "Article 178" is both a real CRR article and a common
    // way to cite EBA GL 2017/16 paragraph 178. The alias keeps the loose
    // spelling resolvable; the confidence level keeps it from being reported as
    // the record's own citation.
    const eba = [
      {
        ...cite("regulation://gl-2017-16/article-178", "Paragraph 178", "eba-gl-2017-16"),
        citation_aliases: ["Article 178"],
      },
    ];
    const r = resolveCitationDetailed(eba, "Article 178");
    expect(r.match?.id).toBe("regulation://gl-2017-16/article-178");
    expect(r.confidence).toBe("alias");
    expect(r.coverage_note).toContain("Paragraph 178");
  });

  it("prefers a record's own citation over another record's alias", () => {
    const both = [
      { ...cite("regulation://gl-2017-16/article-178", "Paragraph 178", "eba-gl-2017-16"), citation_aliases: ["Article 178"] },
      cite("regulation://crr/178", "Article 178", "crr"),
    ];
    const r = resolveCitationDetailed(both, "Article 178");
    expect(r.match?.id).toBe("regulation://crr/178");
    expect(r.confidence).toBe("exact");
  });

  it("routes out of the instrument gate when records cite the missing instrument", () => {
    // A dead end that names the way out: the corpus holds no CRR, but what it
    // does hold elaborates it, and those records are what was being asked for.
    const citing = [
      {
        ...cite("regulation://gl-2017-16/article-78", "Paragraph 78", "eba-gl-2017-16"),
        cites: [{ framework: "crr", citation: "Article 178(1)(a)" }],
      },
    ];
    const r = resolveCitationDetailed(citing, "CRR Article 178");
    expect(r.match).toBeNull();
    expect(r.coverage_note).toContain("1 records do cite it");
    expect(r.coverage_note).toContain("get_referrers");
  });

  it("is what the file adapter's meta.resolveCitation delegates to", async () => {
    const fa = createFileAdapters(loadCorpusFile(writeCorpus("citations.json", { regulation: regs })));
    const hit = await fa.meta.resolveCitation("Art. 178(1)(a)");
    expect(hit.match?.id).toBe("regulation://crr/178/1/a");
    expect(hit.confidence).toBe("exact");
    const declined = await fa.meta.resolveCitation("CRR Article 178");
    expect(declined.match).toBeNull();
    expect(declined.candidates).toHaveLength(2);
  });
});

describe("taxonomy: authored wins, derived fills in", () => {
  // The misfire this closes: the shipped corpus carried `taxonomy: []`, the
  // adapter served it verbatim, and list_review_areas answered {"areas": []} —
  // which also made get_area_overview unreachable, since no slug could match a
  // list that had none. Two of nineteen tools inert, and they are the entry
  // path the server's instructions name first.
  const playbooks = [
    {
      id: "playbook://gl/5-pd-estimation",
      area: "PD Estimation",
      phases: [],
      gates: [],
      regulatory_scope: [],
      last_updated: "2026-01-01",
    },
    {
      id: "playbook://egim/1-credit-risk",
      area: "Credit Risk",
      subarea: "IRB Approach Governance",
      phases: [],
      gates: [],
      regulatory_scope: [],
      last_updated: "2026-01-01",
    },
  ];

  it("serves an authored taxonomy verbatim — it can name areas the corpus lacks", () => {
    const corpus = loadCorpusFile(
      writeCorpus("authored.json", {
        playbooks,
        taxonomy: [{ id: "scope", name: "Scope" }],
      }),
    );
    const a = createFileAdapters(corpus);
    return a.meta.taxonomy().then((t) => {
      expect(t.map((n) => n.id)).toEqual(["scope"]);
    });
  });

  it("derives from the playbooks when the corpus authored none", async () => {
    const corpus = loadCorpusFile(writeCorpus("derived.json", { playbooks }));
    expect(corpus.taxonomy).toEqual([]); // absent on disk
    const t = await createFileAdapters(corpus).meta.taxonomy();
    expect(t.map((n) => n.id)).toEqual([
      "pd-estimation",
      "credit-risk",
      "credit-risk.irb-approach-governance",
    ]);
    expect(t[0]!.name).toBe("PD Estimation");
  });

  it("derives when the corpus authored an EMPTY taxonomy — the shipped case", async () => {
    const corpus = loadCorpusFile(writeCorpus("empty-tax.json", { playbooks, taxonomy: [] }));
    const t = await createFileAdapters(corpus).meta.taxonomy();
    expect(t.length).toBe(3);
  });

  it("still serves [] when there is nothing to derive from", async () => {
    const corpus = loadCorpusFile(writeCorpus("no-playbooks.json", {}));
    expect(await createFileAdapters(corpus).meta.taxonomy()).toEqual([]);
  });
});
