import { beforeAll, describe, expect, it } from "bun:test";

import { createServer } from "../src/server.ts";
import { adapters } from "../src/adapters.ts";
import { playbookInArea, resolveArea } from "../src/areas.ts";
import { buildRegulationTree, computeCoverageGaps, expandRegulation } from "../src/tools/meta.ts";
import { RESPONSE_CHAR_BUDGET } from "../src/tools/shared.ts";

describe("server registration", () => {
  it("constructs without crashing", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("registers the expected surface area (19 tools, 5 resource templates, 3 prompts)", () => {
    const server = createServer();
    const s = server as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
      _registeredPrompts: Record<string, unknown>;
    };
    expect(Object.keys(s._registeredTools).length).toBe(19);
    expect(Object.keys(s._registeredResourceTemplates).length).toBe(5);
    expect(Object.keys(s._registeredPrompts).length).toBe(3);
  });

  it("get_referrers on regulation://crr/180/1/a returns the full reverse index", async () => {
    // Wire the in-memory adapters (side effects in the demo module do the assignment).
    await import("../examples/inmemory-demo.ts");
    const result = await adapters.meta.referrers("regulation://crr/180/1/a");
    expect(result.checks).toEqual(["check://calibration/pd/lra-derived"]);
    // The playbook refers via a phase reference — the scan covers phases, not
    // just regulatory_scope.
    expect(result.playbooks).toEqual(["playbook://calibration/pd"]);
    // The parent article lists it in children — a structural referrer.
    expect(result.regulation).toEqual(["regulation://crr/180"]);
    // All three calibration tests name it in regulatory_basis (order-insensitive).
    expect([...result.tests].sort()).toEqual(
      ["test://binomial", "test://hosmer-lemeshow", "test://jeffreys"],
    );
  });

  it("every registered tool declares read-only annotations and a title", () => {
    const server = createServer();
    const s = server as unknown as {
      _registeredTools: Record<
        string,
        { title?: string; annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } }
      >;
    };
    for (const [name, tool] of Object.entries(s._registeredTools)) {
      expect(tool.annotations?.readOnlyHint, `${name} must declare readOnlyHint`).toBe(true);
      expect(tool.annotations?.idempotentHint, `${name} must declare idempotentHint`).toBe(true);
      expect(tool.annotations?.openWorldHint, `${name} must declare openWorldHint: false`).toBe(false);
      expect(typeof tool.title, `${name} must carry a title`).toBe("string");
      expect((tool.title ?? "").length, `${name} title must be non-empty`).toBeGreaterThan(0);
    }
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

  // These two used to reimplement get_area_overview's resolution and filter
  // inline, which is why nobody noticed the tool compared a slug against
  // free-form prose: the copy was wrong in the same way, and the demo's areas
  // are already slugs ("calibration" + "pd" === "calibration.pd") so both
  // agreed. They now go through the SAME src/areas.ts helpers the tool calls,
  // so a divergence has to fail here. tests/areas.test.ts covers the prose
  // shape real extracted playbooks actually have.
  it("get_area_overview for calibration.pd returns area node, expanded playbooks, and deduplicated ID lists", async () => {
    const area = "calibration.pd";
    const allAreas = await adapters.meta.taxonomy();
    const areaNode = resolveArea(allAreas, area);
    expect(areaNode).toBeDefined();
    expect(areaNode!.id).toBe("calibration.pd");

    const allPlaybooks = await adapters.playbook.list();
    const areaPlaybooks = allPlaybooks.filter((p) => playbookInArea(p, areaNode!));
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
    expect(resolveArea(allAreas, "nonexistent.area")).toBeUndefined();
  });

  it("get_area_overview accepts an area NAME, not only its slug", async () => {
    // What a model has to hand after reading a playbook record is the prose.
    const allAreas = await adapters.meta.taxonomy();
    const byName = resolveArea(allAreas, "PD Calibration");
    expect(byName?.id).toBe("calibration.pd");

    const allPlaybooks = await adapters.playbook.list();
    expect(allPlaybooks.filter((p) => playbookInArea(p, byName!)).length).toBeGreaterThanOrEqual(1);
  });

  it("list_review_areas is never empty for a corpus that has playbooks", async () => {
    // The misfire: the shipped corpus authored no taxonomy, so this answered
    // {"areas": []} and took get_area_overview down with it — the entry path
    // the server's own instructions name first had no reachable second step.
    const areas = await adapters.meta.taxonomy();
    const playbooks = await adapters.playbook.list();
    expect(playbooks.length).toBeGreaterThan(0);
    expect(areas.length).toBeGreaterThan(0);
    // And every area advertised can actually be entered.
    for (const node of areas) {
      expect(resolveArea(areas, node.id)?.id).toBe(node.id);
    }
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
    const regs = await adapters.regulation.list();
    const checks = await adapters.check.list();
    const tests = await adapters.test.list();
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

describe("sources surface", () => {
  beforeAll(async () => {
    await import("../examples/inmemory-demo.ts");
  });

  it("list_sources returns the seeded registry", async () => {
    const all = await adapters.source.list();
    expect(all.length).toBe(6);
  });

  it("list_sources filters by status", async () => {
    const pending = await adapters.source.list({ status: "pending" });
    expect(pending.map((s) => s.id)).toEqual(["source://eba/cp-2025-14"]);
    const superseded = await adapters.source.list({ status: "superseded" });
    expect(superseded.map((s) => s.id)).toEqual(["source://eba/cp-2016-21"]);
  });

  it("get_source resolves a record and misses cleanly", async () => {
    const hit = await adapters.source.get("source://eba/gl-2017-16");
    expect(hit?.document_id).toBe("eba-gl-2017-16");
    expect(hit?.status).toBe("current");
    expect(await adapters.source.get("source://eba/nope")).toBeNull();
  });

  it("the superseded seed points at a resolving current successor", async () => {
    const old = await adapters.source.get("source://eba/cp-2016-21");
    expect(old?.superseded_by).toBe("source://eba/gl-2017-16");
    const successor = await adapters.source.get(old!.superseded_by!);
    expect(successor?.status).toBe("current");
  });

  it("the pending seed carries chronological milestones (first = next)", async () => {
    const pending = await adapters.source.get("source://eba/cp-2025-14");
    expect(pending?.milestones[0]?.event).toBe("Consultation closes");
    expect(pending?.milestones.length).toBe(2);
  });

  it("get_corpus_info counts sources and computes stale_sources", async () => {
    const info = await adapters.meta.info();
    // Explicit assertion because zod-3 records are Partial at the type level —
    // the compiler never forces a source count into counts literals.
    expect(info.counts.source).toBe(6);
    // Exactly the deliberately-stale current seed; the superseded seed with an
    // equally old verified date must stay out.
    expect(info.stale_sources).toEqual(["source://eba/gl-2017-16"]);
  });
});

// ── Wire-level contracts — a real MCP client over a linked in-memory pair ─────
//
// The blocks above call adapters and exported helpers directly; this one runs
// the actual protocol so the tool-result conventions (annotations on the wire,
// the search envelope with structuredContent, isError misses, -32002 resource
// misses, completions) can't silently drift from what a client sees.

describe("MCP wire contracts (in-memory transport)", () => {
  let client: import("@modelcontextprotocol/sdk/client/index.js").Client;

  beforeAll(async () => {
    const { demoServer } = await import("../examples/inmemory-demo.ts");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await demoServer.connect(serverTransport);
    client = new Client({ name: "smoke-test", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  it("tools/list serves 19 tools, each annotated read-only and titled; search tools carry outputSchema", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(19);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, `${t.name} readOnlyHint`).toBe(true);
      expect(t.annotations?.idempotentHint, `${t.name} idempotentHint`).toBe(true);
      expect(t.annotations?.openWorldHint, `${t.name} openWorldHint`).toBe(false);
      expect(t.title, `${t.name} title`).toBeTruthy();
    }
    const searchTools = tools.filter((t) => t.name.startsWith("search_"));
    expect(searchTools.length).toBe(4);
    for (const t of searchTools) expect(t.outputSchema, `${t.name} outputSchema`).toBeDefined();
  });

  it("search_* returns the { results, total_matches, offset, truncated } envelope as structuredContent", async () => {
    const res = await client.callTool({ name: "search_checks", arguments: { query: "long-run average" } });
    expect(res.isError).not.toBe(true);
    const env = res.structuredContent as {
      results: Array<Record<string, unknown>>;
      total_matches: number;
      offset: number;
      truncated: boolean;
    };
    expect(Array.isArray(env.results)).toBe(true);
    expect(typeof env.total_matches).toBe("number");
    expect(env.offset).toBe(0);
    expect(typeof env.truncated).toBe("boolean");
    // Ranked: the check that names the phrase outranks incidental matches.
    expect(env.results[0]?.["id"]).toBe("check://calibration/pd/lra-derived");
    // Concise projection by default — first sentence, not the full expectation.
    expect(typeof env.results[0]?.["expectation_first_sentence"]).toBe("string");
    expect("expectation" in (env.results[0] ?? {})).toBe(false);
    // The spec requires a text block alongside structured content; it mirrors the envelope.
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(text?.type).toBe("text");
    expect(JSON.parse(text!.text).total_matches).toBe(env.total_matches);
  });

  it("search_* pages within the ranked set and flags truncation", async () => {
    const res = await client.callTool({
      name: "search_checks",
      arguments: { query: "definition", detail: "full", limit: 1 },
    });
    const env = res.structuredContent as { results: Array<{ expectation?: string }>; truncated: boolean };
    expect(env.results).toHaveLength(1);
    expect(env.results[0]?.expectation).toBeDefined(); // detail: "full" serves complete records
    expect(env.truncated).toBe(true);

    // One content block, and it parses. The truncation hint used to be appended
    // as a second block, which concatenated into the body a client reads and
    // left it unparseable; it now travels as `notice` inside the envelope.
    const blocks = res.content as Array<{ text?: string }>;
    expect(blocks).toHaveLength(1);
    expect(() => JSON.parse(blocks[0]?.text ?? "")).not.toThrow();
    expect((env as unknown as { notice?: string }).notice).toContain("offset");
  });

  it("get_* misses are isError results with a next-step pointer — never the string 'null'", async () => {
    const res = await client.callTool({ name: "get_check", arguments: { id: "check://nope/nope" } });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("search_checks");
    expect(text).not.toBe("null");
  });

  it("resource misses surface as JSON-RPC -32002, hits read as JSON", async () => {
    expect(client.readResource({ uri: "check://nope/nope" })).rejects.toMatchObject({ code: -32002 });
    const hit = await client.readResource({ uri: "test://jeffreys" });
    expect(JSON.parse((hit.contents[0] as { text: string }).text).name).toBe("Jeffreys test");
  });

  it("resource templates and prompt arguments offer completions", async () => {
    const rc = await client.complete({
      ref: { type: "ref/resource", uri: "check://{+path}" },
      argument: { name: "path", value: "calibration" },
    });
    expect(rc.completion.values).toContain("calibration/pd/lra-derived");
    const pc = await client.complete({
      ref: { type: "ref/prompt", name: "validate_review_area" },
      argument: { name: "area", value: "cali" },
    });
    expect(pc.completion.values).toContain("calibration.pd");
  });

  // The entry path, over the wire. These exist because the unit tests around
  // it all called the shared helpers directly, so a tool that could not
  // REGISTER still passed them: declaring `outputSchema: z.union([...])` on
  // get_playbook crashed the SDK ("undefined is not an object (evaluating
  // 's._zod')") and took BOTH of its modes down, and nothing in the suite
  // noticed. MCP output schemas must be object schemas.
  it("get_playbook serves the full record AND detail: 'steps' over the wire", async () => {
    const full = await client.callTool({
      name: "get_playbook",
      arguments: { id: "playbook://calibration/pd" },
    });
    expect(full.isError).not.toBe(true);
    const fullRec = full.structuredContent as { phases: Array<{ references: string[] }> };
    expect(Array.isArray(fullRec.phases[0]?.references)).toBe(true);

    const steps = await client.callTool({
      name: "get_playbook",
      arguments: { id: "playbook://calibration/pd", detail: "steps" },
    });
    expect(steps.isError).not.toBe(true);
    const rec = steps.structuredContent as {
      phases: Array<{ name: string; description: string; reference_count: number }>;
      gates: string[];
      regulatory_scope_count: number;
    };
    // Same walkthrough, reference arrays replaced by their counts.
    expect(rec.phases.length).toBe(fullRec.phases.length);
    expect(rec.phases[0]?.reference_count).toBe(fullRec.phases[0]!.references.length);
    expect("references" in (rec.phases[0] ?? {})).toBe(false);
    expect(typeof rec.regulatory_scope_count).toBe("number");
    // And it is genuinely smaller — that is the whole point of the mode.
    const size = (r: typeof steps) => JSON.stringify(r.structuredContent).length;
    expect(size(steps)).toBeLessThan(size(full));
  });

  it("list_review_areas is non-empty over the wire, and every id it advertises can be entered", async () => {
    const listed = await client.callTool({ name: "list_review_areas", arguments: {} });
    expect(listed.isError).not.toBe(true);
    const { areas } = listed.structuredContent as { areas: Array<{ id: string; name: string }> };
    expect(areas.length).toBeGreaterThan(0);

    for (const node of areas) {
      const ov = await client.callTool({
        name: "get_area_overview",
        arguments: { area: node.id },
      });
      expect(ov.isError, `get_area_overview(${node.id})`).not.toBe(true);
    }
  });

  it("get_area_overview takes an area NAME, not only its slug", async () => {
    // What an agent has after reading a playbook record is the prose.
    const bySlug = await client.callTool({
      name: "get_area_overview",
      arguments: { area: "calibration.pd" },
    });
    const byName = await client.callTool({
      name: "get_area_overview",
      arguments: { area: "PD Calibration" },
    });
    expect(byName.isError).not.toBe(true);
    expect((byName.structuredContent as { area: { id: string } }).area.id).toBe(
      (bySlug.structuredContent as { area: { id: string } }).area.id,
    );
  });

  it("get_area_overview still misses loudly, naming both accepted forms", async () => {
    const bad = await client.callTool({
      name: "get_area_overview",
      arguments: { area: "not-an-area" },
    });
    expect(bad.isError).toBe(true);
    const text = (bad.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain("list_review_areas");
    expect(text).toMatch(/slug|name/);
  });

  it("get_area_overview lists playbooks referenced by the area's own playbooks", async () => {
    // Some playbooks index others. Without playbook_ids an area whose only
    // playbook is such an index answered "1 playbook, 0 of everything else"
    // and the caller had to expand it anyway.
    const ov = await client.callTool({
      name: "get_area_overview",
      arguments: { area: "calibration" },
    });
    expect(ov.isError).not.toBe(true);
    const d = ov.structuredContent as {
      playbooks: Array<{ id: string }>;
      playbook_ids: string[];
    };
    expect(Array.isArray(d.playbook_ids)).toBe(true);
    // Never re-lists a playbook already expanded in `playbooks`.
    const own = new Set(d.playbooks.map((p) => p.id));
    for (const id of d.playbook_ids) expect(own.has(id)).toBe(false);
    // And no duplicates.
    expect(new Set(d.playbook_ids).size).toBe(d.playbook_ids.length);
  });

  it("a search page is shortened to fit the response ceiling, and says so", async () => {
    // Page size and payload size are different quantities: 20 concise rows are
    // cheap, 20 full records are not. The page shrinks; total_matches does not.
    const res = await client.callTool({
      name: "search_checks",
      arguments: { query: "default", detail: "full", limit: 100 },
    });
    const env = res.structuredContent as {
      results: unknown[];
      returned: number;
      total_matches: number;
      next_offset: number | null;
      notice?: string;
    };
    expect(env.returned).toBe(env.results.length);
    expect(env.total_matches).toBeGreaterThanOrEqual(env.returned);
    // Whatever the page size, the body stays under the ceiling.
    const body = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(body.length).toBeLessThanOrEqual(RESPONSE_CHAR_BUDGET + 1_000);
    if (env.returned < env.total_matches) expect(env.next_offset).toBe(env.returned);
  });

  it("get_area_overview summarises phases instead of restating the ids it already lists", async () => {
    // Every reference stub inside a phase was also an entry in the flat id
    // lists, at roughly twice the bytes — 73% of a real area's payload spent
    // saying the same thing twice.
    const ov = await client.callTool({
      name: "get_area_overview",
      arguments: { area: "calibration" },
    });
    const d = ov.structuredContent as {
      playbooks: Array<{ phases: Array<Record<string, unknown>> }>;
      regulation_ids: string[];
    };
    const phase = d.playbooks[0]?.phases[0];
    expect(phase).toBeDefined();
    expect(phase!["references"]).toBeUndefined();
    expect(phase!["reference_counts"]).toMatchObject({
      regulation: expect.any(Number),
      check: expect.any(Number),
      test: expect.any(Number),
      playbook: expect.any(Number),
    });
    // The references are still reachable — de-duplicated, in the flat lists.
    expect(d.regulation_ids.length).toBeGreaterThan(0);
  });

  it("full search rows cap commentary and declare what they withheld", async () => {
    const res = await client.callTool({
      name: "search_regulation",
      arguments: { query: "commentary", detail: "full", limit: 5 },
    });
    const env = res.structuredContent as {
      results: Array<{ commentary: unknown[]; commentary_omitted?: number }>;
    };
    for (const row of env.results) {
      expect(row.commentary.length).toBeLessThanOrEqual(3);
      // Nothing is dropped silently: an abridged row says how much is missing.
      if (row.commentary_omitted !== undefined) expect(row.commentary_omitted).toBeGreaterThan(0);
    }
  });

  // as_of, over the wire. A record with no recorded history is served from its
  // current text under any date the document existed on — and without a note
  // that is indistinguishable from the text of that date. The demo's only
  // history is on crr/178/1/b, so crr/180 and crr/180/1/a stand in for "no
  // version recorded".
  it("as_of on a record with no history serves current text WITH an as_of_note; a recorded version has none", async () => {
    const noHistory = await client.callTool({
      name: "get_regulation",
      arguments: { id: "regulation://crr/180/1/a", as_of: "2019-01-01" },
    });
    expect(noHistory.isError).not.toBe(true);
    const served = noHistory.structuredContent as { as_of_note?: string; document_version: string; text: string };
    expect(served.text).toContain("long-run averages");
    expect(served.as_of_note).toContain("2019-01-01");
    expect(served.as_of_note).toContain(served.document_version);
    // It reaches the text block a client reads, too.
    const body = JSON.parse((noHistory.content as Array<{ text: string }>)[0]!.text) as { as_of_note?: string };
    expect(body.as_of_note).toBe(served.as_of_note);

    // No as_of, no note — the key is absent rather than empty.
    const latest = await client.callTool({ name: "get_regulation", arguments: { id: "regulation://crr/180/1/a" } });
    expect("as_of_note" in (latest.structuredContent as object)).toBe(false);

    // A recorded version covers the date: that version, no note.
    const covered = await client.callTool({
      name: "get_regulation",
      arguments: { id: "regulation://crr/178/1/b", as_of: "2015-06-01" },
    });
    const old = covered.structuredContent as { document_version: string };
    expect(old.document_version).toBe("2013-06-26");
    expect("as_of_note" in old).toBe(false);

    // Predating every recorded version is still a miss.
    const before = await client.callTool({
      name: "get_regulation",
      arguments: { id: "regulation://crr/178/1/b", as_of: "2010-01-01" },
    });
    expect(before.isError).toBe(true);
  });

  it("expand_regulation and get_regulation_tree carry the as_of_note too", async () => {
    const expanded = await client.callTool({
      name: "expand_regulation",
      arguments: { id: "regulation://crr/180", as_of: "2019-01-01" },
    });
    expect((expanded.structuredContent as { as_of_note?: string }).as_of_note).toContain("2019-01-01");

    // crr/180 and its sub-paragraph crr/180/1/a are both served from current text.
    const tree = await client.callTool({
      name: "get_regulation_tree",
      arguments: { id: "regulation://crr/180", as_of: "2019-01-01" },
    });
    const note = (tree.structuredContent as { as_of_note?: string }).as_of_note;
    expect(note).toContain("1 other provision");
    expect(JSON.stringify(tree.structuredContent).match(/as_of_note/g)).toHaveLength(1);

    const plainTree = await client.callTool({
      name: "get_regulation_tree",
      arguments: { id: "regulation://crr/180" },
    });
    expect("as_of_note" in (plainTree.structuredContent as object)).toBe(false);
  });

  it("resolve_citation declines rather than answering with a near-numbered provision", async () => {
    const hit = await client.callTool({
      name: "resolve_citation",
      arguments: { text: "Art. 178(1)(a)" },
    });
    const found = hit.structuredContent as { match: { id: string } | null; confidence: string };
    expect(found.match?.id).toBe("regulation://crr/178/1/a");
    expect(found.confidence).not.toBe("none");

    // An instrument this corpus does not hold is not answered out of one it does.
    const foreign = await client.callTool({
      name: "resolve_citation",
      arguments: { text: "Article 1 of Regulation (EU) No 9999/9999" },
    });
    const declined = foreign.structuredContent as {
      match: unknown;
      candidates: unknown[];
      coverage_note?: string;
    };
    expect(declined.match).toBeNull();
    expect(declined.candidates).toEqual([]);
    expect(declined.coverage_note).toContain("9999/9999");
  });
});
