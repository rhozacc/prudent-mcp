import { beforeAll, describe, expect, it } from "bun:test";

import { adapters } from "../src/adapters.ts";
import { CheckSchema, RegulationSchema, TestSchema } from "../src/schema.ts";

// ── Schema contract — the runtime half of the template-literal types ──────────
//
// children widened to RegulationChildId = RegulationId | TestId | CheckId, and
// Check/Test gained an optional regulation parent. zod is the boundary that
// enforces this on data crossing the adapter, so assert it directly.

const baseRegulation = {
  id: "regulation://crr/180",
  framework: "crr",
  document_id: "crr",
  document_version: "2024-01-09",
  citation: "CRR Article 180",
  text: "Requirements for institution-specific PD estimates.",
};

describe("RegulationSchema.children", () => {
  it("accepts a mix of regulation, test, and check child IDs", () => {
    const reg = RegulationSchema.parse({
      ...baseRegulation,
      children: [
        "regulation://crr/180/1/a",
        "test://jeffreys",
        "check://calibration/pd/lra-derived",
      ],
    });
    expect(reg.children).toHaveLength(3);
  });

  it("defaults children to [] when omitted", () => {
    expect(RegulationSchema.parse(baseRegulation).children).toEqual([]);
  });

  it("rejects a playbook:// child — playbooks reference regulation, never the reverse", () => {
    const result = RegulationSchema.safeParse({
      ...baseRegulation,
      children: ["playbook://calibration/pd"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a child string with no surface scheme", () => {
    const result = RegulationSchema.safeParse({
      ...baseRegulation,
      children: ["crr/180/1/a"],
    });
    expect(result.success).toBe(false);
  });
});

describe("Check.parent and Test.parent", () => {
  const baseCheck = {
    id: "check://calibration/pd/lra-derived",
    name: "PD long-run average derived from sufficient history",
    expectation: "LRA covers a full economic cycle.",
    last_updated: "2024-09-01",
  };
  const baseTest = {
    id: "test://jeffreys",
    name: "Jeffreys test",
    purpose: "Bayesian test for PD calibration.",
    last_updated: "2024-06-01",
  };

  it("Check accepts an optional regulation parent", () => {
    const check = CheckSchema.parse({ ...baseCheck, parent: "regulation://crr/180/1/a" });
    expect(check.parent).toBe("regulation://crr/180/1/a");
  });

  it("Check is valid without a parent", () => {
    expect(CheckSchema.parse(baseCheck).parent).toBeUndefined();
  });

  it("Check rejects a non-regulation parent", () => {
    expect(CheckSchema.safeParse({ ...baseCheck, parent: "check://other" }).success).toBe(false);
  });

  it("Test accepts an optional regulation parent", () => {
    const test = TestSchema.parse({ ...baseTest, parent: "regulation://eba/gl-2017-16/78" });
    expect(test.parent).toBe("regulation://eba/gl-2017-16/78");
  });

  it("Test rejects a non-regulation parent", () => {
    expect(TestSchema.safeParse({ ...baseTest, parent: "test://other" }).success).toBe(false);
  });
});

// ── Mirror invariant — machine-checked over the seed corpus ───────────────────
//
// Convention (docs/corpus/index.md): a check/test listed in Regulation.children
// MUST point back via parent AND name that regulation in its derived_from /
// regulatory_basis. This keeps the forward up-links authoritative so
// get_referrers stays the single computed reverse index. Enforce it as data.

describe("seed corpus consistency", () => {
  beforeAll(async () => {
    // Side-effect import wires the in-memory adapters.
    await import("../examples/inmemory-demo.ts");
  });

  it("every check/test child mirrors its parent regulation (parent + derived_from/regulatory_basis)", async () => {
    const regulations = await adapters.regulation.search("");
    expect(regulations.length).toBeGreaterThan(0);

    let mirroredPairs = 0;
    for (const reg of regulations) {
      for (const childId of reg.children) {
        if (childId.startsWith("check://")) {
          const check = await adapters.check.get(childId as `check://${string}`);
          expect(check, `child ${childId} of ${reg.id} should resolve`).not.toBeNull();
          expect(check!.parent, `${childId}.parent should point back to ${reg.id}`).toBe(reg.id);
          expect(
            check!.derived_from,
            `${reg.id} must appear in ${childId}.derived_from (mirror invariant)`,
          ).toContain(reg.id);
          mirroredPairs++;
        } else if (childId.startsWith("test://")) {
          const test = await adapters.test.get(childId as `test://${string}`);
          expect(test, `child ${childId} of ${reg.id} should resolve`).not.toBeNull();
          expect(test!.parent, `${childId}.parent should point back to ${reg.id}`).toBe(reg.id);
          expect(
            test!.regulatory_basis,
            `${reg.id} must appear in ${childId}.regulatory_basis (mirror invariant)`,
          ).toContain(reg.id);
          mirroredPairs++;
        }
      }
    }

    // Guard against a vacuous pass — the demo must actually exercise the relationship.
    expect(mirroredPairs).toBeGreaterThan(0);
  });

  it("every regulation child resolves and points back via parent", async () => {
    const regulations = await adapters.regulation.search("");
    const byId = new Map(regulations.map((r) => [r.id, r]));

    for (const reg of regulations) {
      for (const childId of reg.children) {
        if (!childId.startsWith("regulation://")) continue;
        const child = byId.get(childId as `regulation://${string}`);
        expect(child, `regulation child ${childId} of ${reg.id} should exist`).toBeDefined();
        expect(child!.parent).toBe(reg.id);
      }
    }
  });
});
