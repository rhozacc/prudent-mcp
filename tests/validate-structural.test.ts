import { describe, expect, it } from "bun:test";

import {
  CheckSchema,
  PlaybookSchema,
  RegulationSchema,
  TestSchema,
} from "../src/schema.ts";
import type {
  Check,
  Playbook,
  Regulation,
  RegulationChildId,
  Test,
} from "../src/schema.ts";
import { validateCorpus } from "../src/validate.ts";

// Rules 1–4 are clock-free (only the source-registry rules read `now`), so no
// fixed clock is needed here — see tests/validate.test.ts for the dated rules.

// Build fixtures through the schemas themselves so defaults apply and every
// fixture is provably a valid record before the rule under test sees it —
// same pattern as the source() helper in tests/validate.test.ts.
function reg(overrides: Partial<Regulation> & Pick<Regulation, "id">): Regulation {
  return RegulationSchema.parse({
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Art. X",
    text: "Some regulatory text.",
    ...overrides,
  });
}

function check(overrides: Partial<Check> & Pick<Check, "id">): Check {
  return CheckSchema.parse({
    name: "Some check",
    expectation: "Some concrete bar.",
    last_updated: "2026-08-01",
    ...overrides,
  });
}

function testRecord(overrides: Partial<Test> & Pick<Test, "id">): Test {
  return TestSchema.parse({
    name: "Some test",
    purpose: "Some purpose.",
    last_updated: "2026-08-01",
    ...overrides,
  });
}

function playbook(overrides: Partial<Playbook> & Pick<Playbook, "id">, cites: string[] = []): Playbook {
  return PlaybookSchema.parse({
    title: "A playbook",
    area: "calibration",
    summary: "What to show.",
    questions: ["A question?"],
    basis: [],
    requirements: [{ id: "R1", title: "A requirement", statement: "Do it.", provisions: (cites.length > 0 ? cites : ["regulation://crr/180"]).map((id) => ({ id })) }],
    provenance: { status: "approved", compiled_at: "2026-08-01T00:00:00Z", inputs_sha: "0".repeat(64) },
    ...overrides,
  });
}

const empty = { regulation: [], tests: [], checks: [], playbooks: [] };

describe("validateCorpus — rule 1: mirror invariant for check/test children", () => {
  it("accepts a check child that points back via parent and derived_from", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180", children: ["check://calibration/pd/x"] })],
      checks: [
        check({
          id: "check://calibration/pd/x",
          parent: "regulation://crr/180",
          derived_from: ["regulation://crr/180"],
        }),
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a check child whose parent points at a different regulation", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/180", children: ["check://calibration/pd/x"] }),
        reg({ id: "regulation://crr/181" }),
      ],
      checks: [
        check({
          id: "check://calibration/pd/x",
          parent: "regulation://crr/181",
          derived_from: ["regulation://crr/180"],
        }),
      ],
    });
    expect(errors).toContain(
      "regulation://crr/180: check child check://calibration/pd/x has parent regulation://crr/181, expected regulation://crr/180",
    );
  });

  it("rejects a check child with no parent at all", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180", children: ["check://calibration/pd/x"] })],
      checks: [
        check({ id: "check://calibration/pd/x", derived_from: ["regulation://crr/180"] }),
      ],
    });
    expect(errors).toContain(
      "regulation://crr/180: check child check://calibration/pd/x has parent (none), expected regulation://crr/180",
    );
  });

  it("rejects a check child that omits the regulation from derived_from", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180", children: ["check://calibration/pd/x"] })],
      checks: [check({ id: "check://calibration/pd/x", parent: "regulation://crr/180" })],
    });
    expect(errors).toContain(
      "regulation://crr/180: check child check://calibration/pd/x does not list it in derived_from (mirror invariant)",
    );
  });

  it("accepts a test child that points back via parent and regulatory_basis", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://eba/gl/78", children: ["test://jeffreys"] })],
      tests: [
        testRecord({
          id: "test://jeffreys",
          parent: "regulation://eba/gl/78",
          regulatory_basis: ["regulation://eba/gl/78"],
        }),
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a test child whose parent points at a different regulation", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://eba/gl/78", children: ["test://jeffreys"] }),
        reg({ id: "regulation://eba/gl/79" }),
      ],
      tests: [
        testRecord({
          id: "test://jeffreys",
          parent: "regulation://eba/gl/79",
          regulatory_basis: ["regulation://eba/gl/78"],
        }),
      ],
    });
    expect(errors).toContain(
      "regulation://eba/gl/78: test child test://jeffreys has parent regulation://eba/gl/79, expected regulation://eba/gl/78",
    );
  });

  it("rejects a test child that omits the regulation from regulatory_basis", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://eba/gl/78", children: ["test://jeffreys"] })],
      tests: [testRecord({ id: "test://jeffreys", parent: "regulation://eba/gl/78" })],
    });
    expect(errors).toContain(
      "regulation://eba/gl/78: test child test://jeffreys does not list it in regulatory_basis (mirror invariant)",
    );
  });

  it("rejects a check whose parent regulation never lists it as a child (child-side mirror)", () => {
    // Rule 3 enforces the child-side half of the mirror invariant: a claimed
    // parent must list the check in children AND appear in derived_from.
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180" })],
      checks: [check({ id: "check://calibration/pd/orphan", parent: "regulation://crr/180" })],
    });
    expect(errors).toContain(
      "check://calibration/pd/orphan: parent regulation://crr/180 does not list it in children (mirror invariant)",
    );
    expect(errors).toContain(
      "check://calibration/pd/orphan: parent regulation://crr/180 not in derived_from (mirror invariant)",
    );
  });

  it("rejects a test whose parent regulation never lists it as a child (child-side mirror)", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://eba/gl/78" })],
      tests: [testRecord({ id: "test://orphan", parent: "regulation://eba/gl/78" })],
    });
    expect(errors).toContain(
      "test://orphan: parent regulation://eba/gl/78 does not list it in children (mirror invariant)",
    );
    expect(errors).toContain(
      "test://orphan: parent regulation://eba/gl/78 not in regulatory_basis (mirror invariant)",
    );
  });
});

describe("validateCorpus — rule 2: regulation parent/children bidirectionality", () => {
  it("accepts a bidirectional parent/child pair", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/180", children: ["regulation://crr/180/1"] }),
        reg({ id: "regulation://crr/180/1", parent: "regulation://crr/180" }),
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a child whose parent does not list it in children", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/180" }), // no children
        reg({ id: "regulation://crr/180/1", parent: "regulation://crr/180" }),
      ],
    });
    expect(errors).toContain(
      "regulation://crr/180/1: parent regulation://crr/180 does not list it in children (parent/children not bidirectional)",
    );
  });

  it("rejects a listed regulation child that does not point back via parent", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/180", children: ["regulation://crr/180/1"] }),
        reg({ id: "regulation://crr/180/1" }), // no parent
      ],
    });
    expect(errors).toContain(
      "regulation://crr/180: regulation child regulation://crr/180/1 does not point back via parent",
    );
  });
});

describe("validateCorpus — rule 3: dangling references", () => {
  it("accepts a corpus where every reference on every surface resolves", () => {
    const errors = validateCorpus({
      regulation: [
        reg({
          id: "regulation://crr/180",
          children: ["regulation://crr/180/1", "check://calibration/pd/x", "test://jeffreys"],
        }),
        reg({ id: "regulation://crr/180/1", parent: "regulation://crr/180" }),
      ],
      checks: [
        check({
          id: "check://calibration/pd/x",
          parent: "regulation://crr/180",
          derived_from: ["regulation://crr/180"],
        }),
      ],
      tests: [
        testRecord({
          id: "test://jeffreys",
          parent: "regulation://crr/180",
          regulatory_basis: ["regulation://crr/180"],
        }),
      ],
      playbooks: [
        playbook({
          id: "playbook://calibration-pd",
          requirements: [
            { id: "R1", title: "Walk the references", statement: "Do.", provisions: [{ id: "regulation://crr/180/1" }], evidence: [], checks: ["check://calibration/pd/x"], tests: ["test://jeffreys"] },
          ],
          related: ["playbook://calibration-pd"],
        }),
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a dangling regulation parent", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180/1", parent: "regulation://crr/ghost" })],
    });
    expect(errors).toContain("regulation://crr/180/1: parent regulation://crr/ghost does not resolve");
  });

  it("rejects a dangling child on every child surface", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({
          id: "regulation://crr/180",
          children: ["regulation://crr/ghost", "check://ghost/x", "test://ghost"],
        }),
      ],
    });
    expect(errors).toContain("regulation://crr/180: child regulation://crr/ghost does not resolve");
    expect(errors).toContain("regulation://crr/180: child check://ghost/x does not resolve");
    expect(errors).toContain("regulation://crr/180: child test://ghost does not resolve");
  });

  it("rejects a dangling check.derived_from entry", () => {
    const errors = validateCorpus({
      ...empty,
      checks: [check({ id: "check://calibration/pd/x", derived_from: ["regulation://crr/ghost"] })],
    });
    expect(errors).toContain(
      "check://calibration/pd/x: derived_from regulation://crr/ghost does not resolve",
    );
  });

  it("rejects a dangling check.parent", () => {
    const errors = validateCorpus({
      ...empty,
      checks: [check({ id: "check://calibration/pd/x", parent: "regulation://crr/ghost" })],
    });
    expect(errors).toContain("check://calibration/pd/x: parent regulation://crr/ghost does not resolve");
  });

  it("rejects a dangling test.regulatory_basis entry", () => {
    const errors = validateCorpus({
      ...empty,
      tests: [testRecord({ id: "test://jeffreys", regulatory_basis: ["regulation://crr/ghost"] })],
    });
    expect(errors).toContain("test://jeffreys: regulatory_basis regulation://crr/ghost does not resolve");
  });

  it("rejects a dangling test.parent", () => {
    const errors = validateCorpus({
      ...empty,
      tests: [testRecord({ id: "test://jeffreys", parent: "regulation://crr/ghost" })],
    });
    expect(errors).toContain("test://jeffreys: parent regulation://crr/ghost does not resolve");
  });

  it("rejects a playbook that cites a provision that does not resolve", () => {
    const errors = validateCorpus({
      ...empty,
      playbooks: [playbook({ id: "playbook://calibration-pd" }, ["regulation://crr/ghost"])],
    });
    expect(errors).toContain("playbook://calibration-pd: provision regulation://crr/ghost does not resolve");
  });

  it("rejects dangling excluded, check, test and related ids on a playbook", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [reg({ id: "regulation://crr/180" })],
      playbooks: [
        playbook({
          id: "playbook://calibration-pd",
          excluded: [{ id: "regulation://crr/ghost", reason: "x" }],
          requirements: [{ id: "R1", title: "T", statement: "S", provisions: [{ id: "regulation://crr/180" }], evidence: [], checks: ["check://ghost/x"], tests: ["test://ghost"] }],
          related: ["playbook://ghost"],
        }),
      ],
    });
    expect(errors).toContain("playbook://calibration-pd: excluded regulation://crr/ghost does not resolve");
    expect(errors).toContain("playbook://calibration-pd / R1: check check://ghost/x does not resolve");
    expect(errors).toContain("playbook://calibration-pd / R1: test test://ghost does not resolve");
    expect(errors).toContain("playbook://calibration-pd: related playbook://ghost does not resolve");
  });

  it("rejects a playbook:// id in regulation children as an invalid child surface", () => {
    // The type system forbids this (RegulationChildId excludes PlaybookId), so
    // the fixture is constructed via a cast — exactly the runtime hole the rule
    // exists to close. The playbook must exist in the corpus: a resolving
    // playbook child hits the invalid-surface branch, a missing one is reported
    // as a dangling child instead.
    const r = reg({ id: "regulation://crr/180" });
    r.children.push("playbook://calibration-pd" as unknown as RegulationChildId);
    const errors = validateCorpus({
      ...empty,
      regulation: [r],
      playbooks: [playbook({ id: "playbook://calibration-pd" })],
    });
    expect(errors).toContain(
      "regulation://crr/180: child playbook://calibration-pd is not a valid child surface (regulation/test/check only)",
    );
  });
});

describe("validateCorpus — rule 4: cycles in the regulation parent chain", () => {
  it("accepts an acyclic parent chain", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/root", children: ["regulation://crr/mid"] }),
        reg({
          id: "regulation://crr/mid",
          parent: "regulation://crr/root",
          children: ["regulation://crr/leaf"],
        }),
        reg({ id: "regulation://crr/leaf", parent: "regulation://crr/mid" }),
      ],
    });
    expect(errors).toEqual([]);
  });

  it("rejects a self-parenting regulation (1-cycle)", () => {
    // Children mirror the parent pointer so bidirectionality noise stays out
    // and the only violation left is the cycle itself.
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/self", parent: "regulation://crr/self", children: ["regulation://crr/self"] }),
      ],
    });
    expect(errors).toEqual([
      "parent cycle reachable from regulation://crr/self (revisits regulation://crr/self)",
    ]);
  });

  it("rejects a mutual parent chain (2-cycle)", () => {
    const errors = validateCorpus({
      ...empty,
      regulation: [
        reg({ id: "regulation://crr/a", parent: "regulation://crr/b", children: ["regulation://crr/b"] }),
        reg({ id: "regulation://crr/b", parent: "regulation://crr/a", children: ["regulation://crr/a"] }),
      ],
    });
    expect(errors.some((e) => e.startsWith("parent cycle reachable from regulation://crr/a"))).toBe(true);
    expect(errors.some((e) => e.startsWith("parent cycle reachable from regulation://crr/b"))).toBe(true);
    expect(errors.every((e) => e.includes("parent cycle reachable from"))).toBe(true);
  });
});
