import { describe, expect, it } from "bun:test";

import { createFileAdapters, CorpusFileSchema } from "../src/file-adapter.ts";
import { ApplicabilitySchema, CheckSchema, PlaybookSchema, RegulationSchema, TestSchema } from "../src/schema.ts";
import { DEMO_PLAYBOOKS } from "../examples/inmemory-demo.ts";

// `applicability` is a discriminated union on `status`, optional on every surface that can be repealed or not yet in
// application, and ABSENT is a state of its own: never defaulted, so a corpus that declares nothing declares nothing.

const reg = {
  id: "regulation://synthetic/old-approach/1",
  framework: "synthetic",
  document_id: "synthetic",
  document_version: "2024-01-01",
  citation: "Article 1",
  text: "Synthetic text.",
};

describe("ApplicabilitySchema", () => {
  it("accepts historical with an ISO until, a reason and replaced_by ids", () => {
    const a = ApplicabilitySchema.parse({ status: "historical", until: "2024-12-31", reason: "Withdrawn.", replaced_by: ["regulation://synthetic/new/1"] });
    expect(a.status).toBe("historical");
  });
  it("requires `until` on historical", () => {
    expect(ApplicabilitySchema.safeParse({ status: "historical", reason: "Withdrawn." }).success).toBe(false);
  });
  it("rejects a malformed until", () => {
    expect(ApplicabilitySchema.safeParse({ status: "historical", until: "31/12/2024", reason: "x" }).success).toBe(false);
  });
  it("accepts upcoming with and without a date", () => {
    expect(ApplicabilitySchema.safeParse({ status: "upcoming", from: "2027-01-01", reason: "Postponed." }).success).toBe(true);
    expect(ApplicabilitySchema.safeParse({ status: "upcoming", reason: "Postponed." }).success).toBe(true);
  });
  it("rejects a malformed `from` and an empty reason", () => {
    expect(ApplicabilitySchema.safeParse({ status: "upcoming", from: "soon", reason: "x" }).success).toBe(false);
    expect(ApplicabilitySchema.safeParse({ status: "upcoming", reason: "" }).success).toBe(false);
    expect(ApplicabilitySchema.safeParse({ status: "historical", until: "2024-12-31", reason: "" }).success).toBe(false);
  });
  it("rejects replaced_by that is not a provision id", () => {
    expect(ApplicabilitySchema.safeParse({ status: "historical", until: "2024-12-31", reason: "x", replaced_by: ["check://a/b"] }).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(ApplicabilitySchema.safeParse({ status: "current", reason: "x" }).success).toBe(false);
  });
});

describe("applicability on the surfaces", () => {
  const app = { status: "upcoming", from: "2099-01-01", reason: "Not yet applicable." } as const;
  it("is optional on Regulation, Check, Test and Playbook, and never defaulted", () => {
    expect(RegulationSchema.parse(reg).applicability).toBeUndefined();
    expect("applicability" in RegulationSchema.parse(reg)).toBe(false);
    expect(RegulationSchema.parse({ ...reg, applicability: app }).applicability).toEqual(app);
    expect(CheckSchema.parse({ id: "check://a/b", name: "n", expectation: "e", last_updated: "2024-01-01", applicability: app }).applicability).toEqual(app);
    expect(TestSchema.parse({ id: "test://a", name: "n", purpose: "p", last_updated: "2024-01-01", applicability: app }).applicability).toEqual(app);
    const pb = Object.values(DEMO_PLAYBOOKS)[0]!;
    expect("applicability" in PlaybookSchema.parse(pb)).toBe(false);
    expect(PlaybookSchema.parse({ ...pb, applicability: app }).applicability).toEqual(app);
  });
  it("survives the corpus file loader", () => {
    const parsed = CorpusFileSchema.parse({ regulation: [{ ...reg, applicability: app }] });
    expect(parsed.regulation[0]!.applicability).toEqual(app);
    expect(createFileAdapters(parsed)).toBeDefined();
  });
});
