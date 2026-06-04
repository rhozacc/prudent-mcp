import { beforeAll, describe, expect, it } from "bun:test";

import { createServer } from "../src/server.ts";
import { adapters } from "../src/adapters.ts";
import { buildRegulationTree, computeCoverageGaps, expandRegulation } from "../src/tools/meta.ts";

describe("server registration", () => {
  it("constructs without crashing", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("registers the expected surface area (17 tools, 4 resource templates, 3 prompts)", () => {
    const server = createServer();
    const s = server as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
      _registeredPrompts: Record<string, unknown>;
    };
    expect(Object.keys(s._registeredTools).length).toBe(17);
    expect(Object.keys(s._registeredResourceTemplates).length).toBe(4);
    expect(Object.keys(s._registeredPrompts).length).toBe(3);
  });

  it("get_referrers on regulation://crr/180/1/a returns checks and playbooks that reference it", async () => {
    // Wire the in-memory adapters (side effects in the demo module do the assignment).
    await import("../examples/inmemory-demo.ts");
    const result = await adapters.meta.referrers("regulation://crr/180/1/a");
    expect(result.checks).toEqual(["check://calibration/pd/lra-derived"]);
    expect(result.playbooks).toEqual(["playbook://calibration/pd"]);
    expect(result.regulation).toEqual([]);
    expect(result.tests).toEqual([]);
  });
});

describe("traversal tools", () => {
  beforeAll(async () => {
    await import("../examples/inmemory-demo.ts");
  });

  it("expand_playbook resolves all phase references inline for playbook://calibration/pd", async () => {
    const raw = await adapters.playbook.get("playbook://calibration/pd");
    expect(raw).not.toBeNull();
    const phases = await Promise.all(
      raw!.phases.map(async (ph) => ({
        ...ph,
        references: await Promise.all(
          ph.references.map(async (id) => {
            if (id.startsWith("test://")) return { type: "test", id, record: await adapters.test.get(id as `test://${string}`) };
            if (id.startsWith("check://")) return { type: "check", id, record: await adapters.check.get(id as `check://${string}`) };
            if (id.startsWith("regulation://")) return { type: "regulation", id, record: await adapters.regulation.get(id as `regulation://${string}`) };
            return { type: "playbook", id, record: await adapters.playbook.get(id as `playbook://${string}`) };
          }),
        ),
      })),
    );
    const phase2 = phases[1]!;
    expect(phase2.references[0]!.type).toBe("test");
    expect(phase2.references[0]!.id).toBe("test://jeffreys");
    expect(phase2.references[0]!.record).not.toBeNull();
    const phase1 = phases[0]!;
    expect(phase1.references[2]!.type).toBe("check");
    expect(phase1.references[2]!.id).toBe("check://calibration/pd/lra-derived");
    expect(phase1.references[2]!.record).not.toBeNull();
  });

  it("expand_playbook returns null for an unknown playbook ID", async () => {
    const result = await adapters.playbook.get("playbook://nonexistent" as `playbook://${string}`);
    expect(result).toBeNull();
  });

  it("get_area_overview for calibration.pd returns area node, expanded playbooks, and deduplicated ID lists", async () => {
    const area = "calibration.pd";
    const allAreas = await adapters.meta.taxonomy();
    const areaNode = allAreas.find((a) => a.id === area);
    expect(areaNode).toBeDefined();
    expect(areaNode!.id).toBe("calibration.pd");

    const allPlaybooks = await adapters.playbook.search("");
    const areaPlaybooks = allPlaybooks.filter(
      (p) => p.area === area || (p.subarea !== undefined && `${p.area}.${p.subarea}` === area),
    );
    expect(areaPlaybooks.length).toBeGreaterThanOrEqual(1);

    const regulation_ids: string[] = [];
    const check_ids: string[] = [];
    const test_ids: string[] = [];
    const seenReg = new Set<string>();
    const seenCheck = new Set<string>();
    const seenTest = new Set<string>();

    for (const pb of areaPlaybooks) {
      for (const ph of pb.phases) {
        for (const id of ph.references) {
          if (id.startsWith("regulation://") && !seenReg.has(id)) { seenReg.add(id); regulation_ids.push(id); }
          if (id.startsWith("check://") && !seenCheck.has(id)) { seenCheck.add(id); check_ids.push(id); }
          if (id.startsWith("test://") && !seenTest.has(id)) { seenTest.add(id); test_ids.push(id); }
        }
      }
    }

    expect(regulation_ids).toContain("regulation://crr/180/1/a");
    expect(regulation_ids).toContain("regulation://eba/gl-2017-16/78");
    expect(test_ids).toContain("test://jeffreys");
    expect(check_ids).toContain("check://calibration/pd/lra-derived");
    // No duplicates
    expect(new Set(regulation_ids).size).toBe(regulation_ids.length);
    expect(new Set(test_ids).size).toBe(test_ids.length);
    expect(new Set(check_ids).size).toBe(check_ids.length);
  });

  it("get_area_overview returns null for an unknown area slug", async () => {
    const allAreas = await adapters.meta.taxonomy();
    const areaNode = allAreas.find((a) => a.id === "nonexistent.area");
    expect(areaNode).toBeUndefined();
  });

  it("get_check returns expected_evidence for check://calibration/pd/lra-derived", async () => {
    const check = await adapters.check.get("check://calibration/pd/lra-derived");
    expect(check).not.toBeNull();
    expect(Array.isArray(check!.expected_evidence)).toBe(true);
    expect(check!.expected_evidence.length).toBeGreaterThan(0);
    expect(check!.expected_evidence[0]).toContain("default rate time series");
  });

  it("regulation children can hold checks and tests, mirrored by parent + derived_from/regulatory_basis", async () => {
    // A leaf paragraph that attaches an operationalizing check as a child.
    const reg = await adapters.regulation.get("regulation://crr/180/1/a");
    expect(reg).not.toBeNull();
    expect(reg!.children).toContain("check://calibration/pd/lra-derived");

    const check = await adapters.check.get("check://calibration/pd/lra-derived");
    expect(check!.parent).toBe("regulation://crr/180/1/a");
    expect(check!.derived_from).toContain("regulation://crr/180/1/a"); // mirror invariant

    // A paragraph that attaches calibration tests as children.
    const eba = await adapters.regulation.get("regulation://eba/gl-2017-16/78");
    expect(eba!.children).toContain("test://jeffreys");

    const test = await adapters.test.get("test://jeffreys");
    expect(test!.parent).toBe("regulation://eba/gl-2017-16/78");
    expect(test!.regulatory_basis).toContain("regulation://eba/gl-2017-16/78"); // mirror invariant

    // An article-level record whose children mix a sub-regulation and a check.
    const art = await adapters.regulation.get("regulation://crr/180");
    expect(art!.children).toEqual(
      expect.arrayContaining([
        "regulation://crr/180/1/a",
        "check://calibration/pd/segment-tested",
      ]),
    );
  });

  it("expand_regulation resolves a regulation's check/test children inline", async () => {
    const raw = await adapters.regulation.get("regulation://crr/180/1/a");
    expect(raw).not.toBeNull();
    const expanded = await expandRegulation(raw!);
    expect(expanded.id).toBe("regulation://crr/180/1/a");
    const checkChild = expanded.children.find((c) => c.type === "check");
    expect(checkChild?.id).toBe("check://calibration/pd/lra-derived");
    expect(checkChild?.record).not.toBeNull();
  });

  it("get_regulation_tree walks sub-regulations and attaches check/test leaves", async () => {
    const tree = await buildRegulationTree("regulation://crr/180", 5, new Set());
    expect(tree.type).toBe("regulation");

    // crr/180's children mix a sub-regulation and a check.
    const checkChild = tree.children.find((c) => c.type === "check");
    expect(checkChild?.id).toBe("check://calibration/pd/segment-tested");

    const regChild = tree.children.find((c) => c.type === "regulation");
    expect(regChild).toBeDefined();
    if (regChild && regChild.type === "regulation") {
      expect(regChild.id).toBe("regulation://crr/180/1/a");
      // …and that sub-regulation carries the lra-derived check as its own leaf.
      const grandchildCheck = regChild.children.find((c) => c.type === "check");
      expect(grandchildCheck?.id).toBe("check://calibration/pd/lra-derived");
    }
  });

  it("get_regulation_tree flags truncation at depth 0", async () => {
    const tree = await buildRegulationTree("regulation://crr/180", 0, new Set());
    expect(tree.children).toHaveLength(0);
    expect(tree.truncated).toBe(true);
  });

  it("get_coverage_gaps flags the uncovered section but not a covered leaf", async () => {
    const regs = await adapters.regulation.search("");
    const checks = await adapters.check.search("");
    const tests = await adapters.test.search("");
    const report = computeCoverageGaps(regs, checks, tests);

    const uncoveredIds = report.uncovered.map((u) => u.id);
    // s4 is a section referenced by no check/test directly — a gap, but not a leaf.
    expect(uncoveredIds).toContain("regulation://eba/gl-2017-16/s4");
    const s4 = report.uncovered.find((u) => u.id === "regulation://eba/gl-2017-16/s4");
    expect(s4?.is_leaf).toBe(false);
    // crr/180/1/a is covered by lra-derived — must not appear as a gap.
    expect(uncoveredIds).not.toContain("regulation://crr/180/1/a");
    expect(report.covered + report.uncovered.length).toBe(report.total_regulations);
  });
});
