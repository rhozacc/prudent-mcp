import { describe, expect, it } from "bun:test";

import { DEMO_PLAYBOOKS } from "../examples/inmemory-demo.ts";
import type { Check, Playbook, Regulation } from "../src/schema.ts";
import { applicabilityWarnings, corpusWarnings, validateCorpus } from "../src/validate.ts";

// A fixed clock: today is 2026-08-26.
const NOW = new Date("2026-08-26T12:00:00Z");

const reg = (id: string, extra: Partial<Regulation> = {}): Regulation => ({
  id: id as Regulation["id"],
  framework: "synthetic",
  document_id: "synthetic",
  document_version: "2024-01-01",
  citation: `Article ${id.split("/").pop()}`,
  text: "Synthetic text.",
  commentary: [],
  children: [],
  ...extra,
});
const base = { tests: [], checks: [] as Check[], playbooks: [] as Playbook[] };
const historical = { status: "historical", until: "2024-12-31", reason: "Withdrawn." } as const;

describe("linter: applicability", () => {
  it("passes a well-formed historical and upcoming declaration", () => {
    const regulation = [
      reg("regulation://synthetic/old", { applicability: { ...historical, replaced_by: ["regulation://synthetic/new"] } }),
      reg("regulation://synthetic/new"),
      reg("regulation://synthetic/later", { applicability: { status: "upcoming", from: "2027-01-01", reason: "Postponed." } }),
      reg("regulation://synthetic/undated", { applicability: { status: "upcoming", reason: "Date not fixed." } }),
    ];
    expect(validateCorpus({ ...base, regulation }, NOW)).toEqual([]);
  });

  it("is fatal when replaced_by does not resolve", () => {
    const regulation = [reg("regulation://synthetic/old", { applicability: { ...historical, replaced_by: ["regulation://synthetic/gone"] } })];
    expect(validateCorpus({ ...base, regulation }, NOW).join("\n")).toContain("replaced_by regulation://synthetic/gone does not resolve");
  });

  it("is fatal when a declaration built without a parse is malformed", () => {
    const bad = (a: unknown): string[] => validateCorpus({ ...base, regulation: [reg("regulation://synthetic/x", { applicability: a as never })] }, NOW);
    expect(bad({ status: "historical", reason: "x" }).join()).toContain("until");
    expect(bad({ status: "historical", until: "2024-13-40", reason: "x" }).join()).toContain("until 2024-13-40");
    expect(bad({ status: "upcoming", from: "next year", reason: "x" }).join()).toContain("from next year");
    expect(bad({ status: "upcoming", reason: "   " }).join()).toContain("reason is empty");
  });

  it("checks every surface that carries it", () => {
    const check: Check = { id: "check://synthetic/c", name: "c", derived_from: [], expectation: "e", expected_evidence: [], last_updated: "2024-01-01", applicability: { status: "upcoming", reason: "" } };
    expect(validateCorpus({ ...base, checks: [check], regulation: [] }, NOW).join()).toContain("check://synthetic/c: applicability.reason is empty");
  });

  it("warns when a historical until is still ahead", () => {
    const regulation = [reg("regulation://synthetic/old", { applicability: { ...historical, until: "2027-01-01" } })];
    const w = applicabilityWarnings({ ...base, regulation }, NOW);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("still ahead");
    expect(corpusWarnings({ ...base, regulation }, NOW).join()).toContain("still ahead");
  });

  it("warns when an upcoming from has passed", () => {
    const regulation = [reg("regulation://synthetic/later", { applicability: { status: "upcoming", from: "2026-01-01", reason: "x" } })];
    expect(applicabilityWarnings({ ...base, regulation }, NOW)[0]).toContain("has passed");
  });

  it("warns when a playbook that is not historical rests on a historical provision, and not when it is", () => {
    const pb = Object.values(DEMO_PLAYBOOKS)[0]!;
    const cited = pb.requirements[0]!.provisions[0]!.id;
    const regulation = [reg(cited, { applicability: historical })];
    expect(applicabilityWarnings({ ...base, regulation, playbooks: [pb] }, NOW).join()).toContain("is not itself marked historical");
    expect(applicabilityWarnings({ ...base, regulation, playbooks: [{ ...pb, applicability: historical }] }, NOW)).toEqual([]);
  });

  it("is silent when nothing declares anything", () => {
    expect(applicabilityWarnings({ ...base, regulation: [reg("regulation://synthetic/a")], playbooks: [Object.values(DEMO_PLAYBOOKS)[0]!] }, NOW)).toEqual([]);
  });
});
