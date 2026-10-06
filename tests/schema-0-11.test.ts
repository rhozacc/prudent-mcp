import { describe, expect, it } from "bun:test";

import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import { RegulationSchema, SourceSchema } from "../src/schema.ts";
import { validateCorpus } from "../src/validate.ts";

// 0.11 adds optional fields only. Two promises are tested here: the new fields
// survive a trip through the schemas (and through the file adapter), and a
// corpus that carries none of them parses to exactly what it did before —
// absent is not empty.

const NOW = new Date("2026-10-06T12:00:00Z");

const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  framework: "eba",
  document_id: "gl-a",
  document_version: "2026-01-01",
  citation: "Paragraph 1",
  text: "Institutions shall document the data used.",
  ...over,
});

const source = (over: Record<string, unknown> = {}) => ({
  id: "source://eba/gl-a",
  title: "Guidelines A",
  framework: "eba",
  document_id: "gl-a",
  doc_type: "guideline",
  status: "current",
  verified: "2026-10-01",
  ...over,
});

describe("0.11 fields round-trip", () => {
  it("Regulation keeps heading_path, role and amends", () => {
    const parsed = RegulationSchema.parse(
      rec("regulation://gl-b/paragraph-9", {
        document_id: "gl-b",
        heading_path: ["Section 4", "Section 4.2.4 Representativeness"],
        role: "operative",
        amends: [{ target: "regulation://gl-a/paragraph-1", op: "replace", effective_from: "2026-10-19" }],
      }),
    );
    expect(parsed.heading_path).toEqual(["Section 4", "Section 4.2.4 Representativeness"]);
    expect(parsed.role).toBe("operative");
    expect(parsed.amends).toEqual([
      { target: "regulation://gl-a/paragraph-1", op: "replace", effective_from: "2026-10-19" },
    ]);
  });

  it("an amendment may be confined to a point, and an empty point is not one", () => {
    const parsed = RegulationSchema.parse(
      rec("regulation://gl-b/paragraph-9", {
        document_id: "gl-b",
        amends: [{ target: "regulation://gl-a/paragraph-1", op: "delete", effective_from: "2026-10-19", point: "(a)" }],
      }),
    );
    expect(parsed.amends?.[0]?.point).toBe("(a)");
    expect(() =>
      RegulationSchema.parse(
        rec("regulation://gl-b/paragraph-9", {
          amends: [{ target: "regulation://gl-a/paragraph-1", op: "delete", effective_from: "2026-10-19", point: "" }],
        }),
      ),
    ).toThrow();
  });

  it("rejects an unknown role, an unknown op and a non-ISO date", () => {
    expect(() => RegulationSchema.parse(rec("regulation://gl-a/paragraph-1", { role: "preamble" }))).toThrow();
    expect(() =>
      RegulationSchema.parse(
        rec("regulation://gl-a/paragraph-1", {
          amends: [{ target: "regulation://gl-b/paragraph-9", op: "rewrite", effective_from: "2026-10-19" }],
        }),
      ),
    ).toThrow();
    expect(() =>
      RegulationSchema.parse(
        rec("regulation://gl-a/paragraph-1", {
          amends: [{ target: "regulation://gl-b/paragraph-9", op: "delete", effective_from: "19 October 2026" }],
        }),
      ),
    ).toThrow();
  });

  it("Source keeps citation_style and a pending change keeps affects_ids", () => {
    const parsed = SourceSchema.parse(
      source({
        citation_style: { kind: "ecb-guide", chapters: { "3": "Credit risk: PD" } },
        pending_changes: [
          {
            title: "Amending guidelines",
            status: "adopted",
            ingested: false,
            affects_ids: ["regulation://gl-a/paragraph-1"],
          },
        ],
      }),
    );
    expect(parsed.citation_style).toEqual({ kind: "ecb-guide", chapters: { "3": "Credit risk: PD" } });
    expect(parsed.pending_changes?.[0]?.affects_ids).toEqual(["regulation://gl-a/paragraph-1"]);
  });

  it("rejects an unknown citation_style kind", () => {
    expect(() => SourceSchema.parse(source({ citation_style: { kind: "oj" } }))).toThrow();
  });

  it("CorpusFile keeps glossary and topics, and passes unknown topic keys through", () => {
    const parsed = CorpusFileSchema.parse({
      regulation: [rec("regulation://gl-a/paragraph-1")],
      glossary: { rds: ["reference data set"], moc: ["margin of conservatism", "margin of conservatism (MoC)"] },
      topics: {
        areas: [
          {
            id: "data",
            title: "Data",
            topics: [{ id: "representativeness", title: "Representativeness", scope: "x", anchors: ["a"] }],
          },
        ],
      },
    });
    expect(parsed.glossary).toEqual({
      rds: ["reference data set"],
      moc: ["margin of conservatism", "margin of conservatism (MoC)"],
    });
    expect(parsed.topics?.areas[0]?.topics[0]).toEqual({
      id: "representativeness",
      title: "Representativeness",
      scope: "x",
      anchors: ["a"],
    });
  });

  it("the file adapter serves the new fields on get", async () => {
    const corpus = CorpusFileSchema.parse({
      regulation: [
        rec("regulation://gl-a/paragraph-1", { heading_path: ["Section 1"], role: "scope" }),
      ],
    });
    const adapters = createFileAdapters(corpus);
    const got = await adapters.regulation.get("regulation://gl-a/paragraph-1");
    expect(got?.heading_path).toEqual(["Section 1"]);
    expect(got?.role).toBe("scope");
  });
});

describe("a format-1 corpus is unchanged", () => {
  const format1 = {
    regulation: [rec("regulation://gl-a/paragraph-1")],
    sources: [source({ pending_changes: [{ title: "Change", status: "announced", ingested: false }] })],
  };

  it("parses with none of the new keys present — absent is not empty", () => {
    const parsed = CorpusFileSchema.parse(format1);
    const r = parsed.regulation[0]!;
    for (const key of ["heading_path", "role", "amends"]) expect(key in r).toBe(false);
    const s = parsed.sources[0]!;
    expect("citation_style" in s).toBe(false);
    expect("affects_ids" in s.pending_changes![0]!).toBe(false);
    expect("glossary" in parsed).toBe(false);
    expect("topics" in parsed).toBe(false);
  });

  it("serializes identically before and after a second parse", () => {
    const once = CorpusFileSchema.parse(format1);
    const twice = CorpusFileSchema.parse(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("linter rules 8 and 9", () => {
  const base = {
    regulation: [
      RegulationSchema.parse(rec("regulation://gl-a/paragraph-1")),
      RegulationSchema.parse(
        rec("regulation://gl-b/paragraph-9", {
          document_id: "gl-b",
          amends: [{ target: "regulation://gl-a/paragraph-1", op: "replace", effective_from: "2026-10-19" }],
        }),
      ),
    ],
    tests: [],
    checks: [],
    playbooks: [],
  };

  it("accepts an amendment of another document's provision", () => {
    expect(validateCorpus(base, NOW)).toEqual([]);
  });

  it("rejects a target that does not resolve", () => {
    const reg = RegulationSchema.parse(
      rec("regulation://gl-b/paragraph-9", {
        document_id: "gl-b",
        amends: [{ target: "regulation://gl-a/paragraph-77", op: "delete", effective_from: "2026-10-19" }],
      }),
    );
    const errors = validateCorpus({ ...base, regulation: [base.regulation[0]!, reg] }, NOW);
    expect(errors).toEqual(["regulation://gl-b/paragraph-9: amends[0].target regulation://gl-a/paragraph-77 does not resolve"]);
  });

  it("rejects a target in the same document", () => {
    const reg = RegulationSchema.parse(
      rec("regulation://gl-a/paragraph-2", {
        amends: [{ target: "regulation://gl-a/paragraph-1", op: "insert_after", effective_from: "2026-10-19" }],
      }),
    );
    const errors = validateCorpus({ ...base, regulation: [base.regulation[0]!, reg] }, NOW);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("is in the same document (eba/gl-a)");
  });

  it("treats the same document_id under another framework as a different document", () => {
    const reg = RegulationSchema.parse(
      rec("regulation://ecb/gl-a/paragraph-9", {
        framework: "ecb",
        amends: [{ target: "regulation://gl-a/paragraph-1", op: "replace", effective_from: "2026-10-19" }],
      }),
    );
    expect(validateCorpus({ ...base, regulation: [base.regulation[0]!, reg] }, NOW)).toEqual([]);
  });

  it("rejects an affects_ids entry that does not resolve, and accepts one that does", () => {
    const withChange = (ids: string[]) =>
      validateCorpus(
        {
          ...base,
          sources: [
            SourceSchema.parse(
              source({ pending_changes: [{ title: "Change", status: "adopted", ingested: false, affects_ids: ids }] }),
            ),
          ],
        },
        NOW,
      );
    expect(withChange(["regulation://gl-a/paragraph-1"])).toEqual([]);
    expect(withChange(["regulation://gl-a/paragraph-1", "regulation://gl-a/paragraph-404"])).toEqual([
      "source://eba/gl-a: pending_changes[0].affects_ids regulation://gl-a/paragraph-404 does not resolve",
    ]);
  });
});
