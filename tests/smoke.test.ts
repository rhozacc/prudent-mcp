import { beforeAll, describe, expect, it } from "bun:test";

import { adapters } from "../src/adapters.ts";
import { createServer } from "../src/server.ts";
import { RESPONSE_CHAR_BUDGET } from "../src/tools/shared.ts";

describe("server registration", () => {
  it("constructs without crashing", () => {
    expect(createServer()).toBeDefined();
  });

  it("registers the 1.0 surface: 8 tools, 5 resource templates, 1 prompt", () => {
    const s = createServer() as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
      _registeredPrompts: Record<string, unknown>;
    };
    expect(Object.keys(s._registeredTools).sort()).toEqual(["brief", "cite", "get", "playbook", "related", "search", "sources", "topics"]);
    expect(Object.keys(s._registeredResourceTemplates).length).toBe(5);
    expect(Object.keys(s._registeredPrompts)).toEqual(["walk_through"]);
  });

  it("the reverse index on regulation://crr/180/1/a is complete", async () => {
    // Wire the in-memory adapters (side effects in the demo module do the assignment).
    await import("../examples/inmemory-demo.ts");
    const result = await adapters.meta.referrers("regulation://crr/180/1/a");
    expect(result.checks).toEqual(["check://calibration/pd/lra-derived"]);
    // The playbook cites the provision in a requirement and in its basis.
    expect(result.playbooks).toEqual(["playbook://pd-long-run-average"]);
    // The parent article lists it in children: a structural referrer.
    expect(result.regulation).toEqual(["regulation://crr/180"]);
    expect([...result.tests].sort()).toEqual(["test://binomial", "test://hosmer-lemeshow", "test://jeffreys"]);
  });

  it("every registered tool declares read-only annotations and a title", () => {
    const s = createServer() as unknown as {
      _registeredTools: Record<string, { title?: string; annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } }>;
    };
    for (const [name, tool] of Object.entries(s._registeredTools)) {
      expect(tool.annotations?.readOnlyHint, `${name} must declare readOnlyHint`).toBe(true);
      expect(tool.annotations?.idempotentHint, `${name} must declare idempotentHint`).toBe(true);
      expect(tool.annotations?.openWorldHint, `${name} must declare openWorldHint: false`).toBe(false);
      expect((tool.title ?? "").length, `${name} must carry a title`).toBeGreaterThan(0);
    }
  });
});

describe("the seeded records", () => {
  beforeAll(async () => {
    await import("../examples/inmemory-demo.ts");
  });

  it("a check carries expected evidence", async () => {
    const check = await adapters.check.get("check://calibration/pd/lra-derived");
    expect(check!.expected_evidence.length).toBeGreaterThan(0);
    expect(check!.expected_evidence[0]).toContain("default rate time series");
  });

  it("regulation children can hold checks and tests, mirrored by parent + derived_from/regulatory_basis", async () => {
    const reg = await adapters.regulation.get("regulation://crr/180/1/a");
    expect(reg!.children).toContain("check://calibration/pd/lra-derived");
    const check = await adapters.check.get("check://calibration/pd/lra-derived");
    expect(check!.parent).toBe("regulation://crr/180/1/a");
    expect(check!.derived_from).toContain("regulation://crr/180/1/a");
    const eba = await adapters.regulation.get("regulation://eba/gl-2017-16/78");
    expect(eba!.children).toContain("test://jeffreys");
    const test = await adapters.test.get("test://jeffreys");
    expect(test!.parent).toBe("regulation://eba/gl-2017-16/78");
    expect(test!.regulatory_basis).toContain("regulation://eba/gl-2017-16/78");
  });

  it("the source list holds the seeded registry, filters by status and chains supersession", async () => {
    expect((await adapters.source.list()).length).toBe(6);
    expect((await adapters.source.list({ status: "pending" })).map((s) => s.id)).toEqual(["source://eba/cp-2025-14"]);
    const old = await adapters.source.get("source://eba/cp-2016-21");
    expect(old?.superseded_by).toBe("source://eba/gl-2017-16");
    expect((await adapters.source.get(old!.superseded_by!))?.status).toBe("current");
    const pending = await adapters.source.get("source://eba/cp-2025-14");
    expect(pending?.milestones[0]?.event).toBe("Consultation closes");
  });

  it("the library info counts sources and computes stale ones", async () => {
    const info = await adapters.meta.info();
    expect(info.counts.source).toBe(6);
    expect(info.stale_sources).toEqual(["source://eba/gl-2017-16"]);
  });
});

// ── Wire-level contracts: a real MCP client over a linked in-memory pair ─────────────────────────────

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
    await client.listTools(); // caches output schemas: callTool validates every structured result against them
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    return { res, isError: res.isError === true, text, body: (res.structuredContent ?? {}) as Record<string, any> };
  };

  it("tools/list serves 8 tools, each annotated read-only and titled, all with an output schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(8);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, `${t.name} readOnlyHint`).toBe(true);
      expect(t.annotations?.idempotentHint, `${t.name} idempotentHint`).toBe(true);
      expect(t.annotations?.openWorldHint, `${t.name} openWorldHint`).toBe(false);
      expect(t.title, `${t.name} title`).toBeTruthy();
      expect(t.outputSchema, `${t.name} outputSchema`).toBeDefined();
    }
  });

  it("brief returns the playbook as text with its machine part in structuredContent", async () => {
    const r = await call("brief", { question: "How do I estimate the long-run average default rate for a PD model?" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("# Long-run average default rate for PD calibration");
    expect(r.text).toContain("Art. 180(1)(a) CRR");
    // The body carries no internal identifiers: provisions are named by citation.
    expect(r.text).not.toMatch(/regulation:\/\//);
    expect(r.body["playbook"]).toMatchObject({ id: "playbook://pd-long-run-average", status: "approved" });
    expect(Array.isArray(r.body["also_relevant"])).toBe(true);
  });

  it("brief says plainly when no playbook answers, and returns passages", async () => {
    const r = await call("brief", { question: "what is the weather in Paris" });
    expect(r.isError).toBe(false);
    expect(r.body["playbook"]).toBeNull();
    expect(r.text).toMatch(/No playbook answers this question directly/);
  });

  it("playbook opens a requirement with the full text of its provisions, and misses name what exists", async () => {
    const section = await call("playbook", { id: "pd-long-run-average", section: "R1" });
    expect(section.text).toContain("# R1. Estimate PDs by grade from long-run averages");
    expect(section.text).toContain("Institutions shall estimate PDs by obligor grade");
    const unknown = await call("playbook", { id: "nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("pd-long-run-average");
    const noSection = await call("playbook", { id: "pd-long-run-average", section: "R9" });
    expect(noSection.isError).toBe(true);
  });

  it("topics lists the playbook under its area", async () => {
    const r = await call("topics", {});
    expect(r.body["areas"][0]).toMatchObject({ id: "calibration" });
    expect(r.body["areas"][0].playbooks[0]).toMatchObject({ id: "playbook://pd-long-run-average" });
  });

  it("search returns the { results, total_matches, offset, truncated } envelope as structuredContent", async () => {
    const r = await call("search", { query: "long-run average", scope: "checks" });
    expect(r.isError).toBe(false);
    expect(typeof r.body["total_matches"]).toBe("number");
    expect(r.body["offset"]).toBe(0);
    expect(typeof r.body["truncated"]).toBe("boolean");
    expect(r.body["results"][0]["id"]).toBe("check://calibration/pd/lra-derived");
    expect(typeof r.body["results"][0]["expectation"]).toBe("string");
    expect(JSON.parse(r.text).total_matches).toBe(r.body["total_matches"]);
  });

  it("search pages within the ranked set and flags truncation, in one content block that parses", async () => {
    const r = await call("search", { query: "definition", scope: "checks", detail: "full", limit: 1 });
    expect(r.body["results"]).toHaveLength(1);
    expect(r.body["results"][0].expectation).toBeDefined();
    expect(r.body["truncated"]).toBe(true);
    expect(r.res.content as unknown[]).toHaveLength(1);
    expect(r.body["notice"]).toContain("offset");
  });

  it("search can be narrowed to one document", async () => {
    const all = await call("search", { query: "default" });
    const narrowed = await call("search", { query: "default", document: "eba-gl-2017-16" });
    expect(narrowed.body["results"].every((x: { document_id: string }) => x.document_id === "eba-gl-2017-16")).toBe(true);
    expect(narrowed.body["total_matches"]).toBeLessThan(all.body["total_matches"]);
  });

  it("get misses are isError results with a next-step pointer, never the string 'null'", async () => {
    const r = await call("get", { ids: "check://nope/nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("search");
    expect(r.text).not.toBe("null");
    expect((await call("get", { ids: [] })).isError).toBe(true);
    expect((await call("get", { ids: Array.from({ length: 21 }, (_, i) => `check://a/${i}`) })).isError).toBe(true);
  });

  it("get opens several entries of different kinds in one call, and lists what it could not find", async () => {
    const r = await call("get", { ids: ["regulation://crr/180/1/a", "check://calibration/pd/lra-derived", "test://jeffreys", "source://eba/gl-2017-16", "check://nope/nope"] });
    expect(r.isError).toBe(false);
    expect(r.body["records"].map((x: { id: string }) => x.id)).toEqual(["regulation://crr/180/1/a", "check://calibration/pd/lra-derived", "test://jeffreys", "source://eba/gl-2017-16"]);
    expect(r.body["missing"].map((m: { id: string }) => m.id)).toEqual(["check://nope/nope"]);
  });

  it("get shortens a batch to fit the response ceiling and says which entries it left out", async () => {
    const { adapters: a } = await import("../src/adapters.ts");
    const real = a.regulation;
    const big = (n: number) => ({ id: `regulation://big/p-${n}`, framework: "big", document_id: "big-doc", document_version: "v1", citation: `Big ${n}`, text: "x".repeat(9_000), commentary: [], children: [] });
    a.regulation = { ...real, get: async (id) => (id.startsWith("regulation://big/") ? (big(Number(id.split("-").pop())) as never) : real.get(id)) };
    try {
      const ids = Array.from({ length: 6 }, (_, i) => `regulation://big/p-${i}`);
      const r = await call("get", { ids });
      expect(r.text.length).toBeLessThanOrEqual(RESPONSE_CHAR_BUDGET + 4_000);
      expect(r.body["records"].length).toBeLessThan(6);
      expect(r.body["notice"]).toContain("Ask again for");
    } finally {
      a.regulation = real;
    }
  });

  it("full search rows cap commentary and declare what they withheld", async () => {
    const { adapters: a } = await import("../src/adapters.ts");
    const real = a.regulation;
    const rec = { id: "regulation://crr/loud", framework: "crr", document_id: "crr", document_version: "v1", citation: "CRR Article 9999", text: "loudword text.", commentary: Array.from({ length: 8 }, (_, i) => ({ source: `Q&A ${i}`, text: "c" })), children: [] };
    a.regulation = { ...real, search: async () => [rec as never] };
    try {
      const get = await call("get", { ids: "regulation://crr/180/1/a" });
      expect(get.isError).toBe(false);
      const row = (await call("search", { query: "loudword", detail: "full" })).body["results"][0];
      expect(row.commentary).toHaveLength(8); // search rows are the record as stored; get caps what it serves
    } finally {
      a.regulation = real;
    }
  });

  it("cite resolves what it can and declines rather than answering with a near-numbered provision", async () => {
    const hit = await call("cite", { text: "Art. 180(1)(a) CRR" });
    expect(hit.body["match"].id).toBe("regulation://crr/180/1/a");
    expect(hit.body["official_citation"]).toBe("Art. 180(1)(a) CRR");
    const miss = await call("cite", { text: "Article 1801 of the CRR" });
    expect(miss.body["match"]).toBeNull();
    const outside = await call("cite", { text: "Article 1 of Regulation (EU) 2099/930" });
    expect(outside.body["match"]).toBeNull();
    expect(outside.body["notes"][0].type).toBe("outside_library");
    expect(outside.text).not.toContain("coverage_note");
  });

  it("related describes the neighbourhood of a provision", async () => {
    const r = await call("related", { id: "regulation://crr/180/1/a" });
    expect(r.body["citation"]).toBe("Art. 180(1)(a) CRR");
    expect(r.body["parent"].citation).toBe("Art. 180 CRR");
    expect(r.body["checks"].map((c: { id: string }) => c.id)).toEqual(["check://calibration/pd/lra-derived"]);
    expect(r.body["playbooks"][0]).toMatchObject({ id: "playbook://pd-long-run-average", requirements: ["R1"] });
    expect((await call("related", { id: "regulation://nope/1" })).isError).toBe(true);
    expect((await call("related", { id: "banana" })).isError).toBe(true);
  });

  it("sources says what is held and what is changing", async () => {
    const r = await call("sources", {});
    const crr = r.body["documents"].find((d: { document_id: string }) => d.document_id === "crr");
    expect(crr).toMatchObject({ held: "part", open_changes: 1 });
    expect(r.body["changes"][0].state).toBe("upcoming");
    expect(r.body["overdue_for_check"]).toEqual(["source://eba/gl-2017-16"]);
    const one = await call("sources", { id: "eba-gl-2017-16" });
    expect(one.body["document_id"]).toBe("eba-gl-2017-16");
    expect((await call("sources", { id: "nope" })).isError).toBe(true);
  });

  it("resource misses surface as JSON-RPC -32002, hits read as JSON (a playbook as text)", async () => {
    expect(client.readResource({ uri: "check://nope/nope" })).rejects.toMatchObject({ code: -32002 });
    const hit = await client.readResource({ uri: "test://jeffreys" });
    expect(JSON.parse((hit.contents[0] as { text: string }).text).name).toBe("Jeffreys test");
    const pb = await client.readResource({ uri: "playbook://pd-long-run-average" });
    expect((pb.contents[0] as { text: string }).text).toContain("# Long-run average default rate for PD calibration");
  });

  it("resource templates and the prompt's arguments offer completions", async () => {
    const rc = await client.complete({ ref: { type: "ref/resource", uri: "check://{+path}" }, argument: { name: "path", value: "calibration" } });
    expect(rc.completion.values).toContain("calibration/pd/lra-derived");
    const prompt = await client.getPrompt({ name: "walk_through", arguments: { topic: "default definition" } });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain("Call brief");
  });
});
