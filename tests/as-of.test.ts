import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { adapters } from "../src/adapters.ts";
import type { RegulationAdapter } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import type { RegulationId } from "../src/schema.ts";
import { createServer } from "../src/server.ts";

// ── as_of is never silently substituted ────────────────────────────────────────
//
// A corpus with no recorded version of a provision serves its CURRENT text under
// any as_of the document already existed on. That is the best text it has, and
// it is not a miss — but it is indistinguishable from a historical version, so
// a validator asking what applied at an approval date, and the model relaying
// the answer, both took today's text for the text of that date. The tools now
// say so in `as_of_note`. Everything here is a synthetic corpus; nothing in it
// is real law.

const CURRENT = "Synthetic article text, current wording.";
const OLD = "Synthetic article text, wording before the amendment.";

const record = (id: string, citation: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  framework: "acme",
  document_id: "acme-reg",
  document_version: "2024-05-01",
  citation,
  text,
  ...extra,
});

const art1 = record("regulation://acme/art-1", "Acme Article 1", CURRENT, {
  children: ["regulation://acme/art-1/a", "regulation://acme/art-1/b"],
});
const art1a = record("regulation://acme/art-1/a", "Acme Article 1(a)", `${CURRENT} (a)`, { parent: art1.id });
const art1b = record("regulation://acme/art-1/b", "Acme Article 1(b)", `${CURRENT} (b)`, {
  parent: art1.id,
  children: ["regulation://acme/art-1/b/i"],
});
const art1bi = record("regulation://acme/art-1/b/i", "Acme Article 1(b)(i)", `${CURRENT} (b)(i)`, { parent: art1b.id });
// A subtree that is recorded end to end: parent and child both carry history.
const art3 = record("regulation://acme/art-3", "Acme Article 3", CURRENT, { children: ["regulation://acme/art-3/a"] });
const art3a = record("regulation://acme/art-3/a", "Acme Article 3(a)", `${CURRENT} (3a)`, { parent: art3.id });
const young = {
  ...record("regulation://newdoc/p-1", "Newdoc paragraph 1", "Synthetic paragraph of a later document."),
  framework: "newdoc",
  document_id: "newdoc",
  document_version: "2020-01-01",
};

const source = (framework: string, document_id: string, published: string) => ({
  id: `source://${framework}/${document_id}`,
  title: document_id,
  framework,
  document_id,
  doc_type: "regulation",
  status: "current",
  published,
  verified: "2020-01-01",
});

const corpus = CorpusFileSchema.parse({
  regulation: [art1, art1a, art1b, art1bi, art3, art3a, young],
  sources: [source("acme", "acme-reg", "2012-01-01"), source("newdoc", "newdoc", "2020-01-01")],
  regulation_history: [
    // Only art-1/b carries history; written out of order on purpose.
    { id: art1b.id, effective_from: "2022-06-01", record: art1b }, // current-boundary entry
    ...[art3, art3a].flatMap((r) => [
      { id: r.id, effective_from: "2022-06-01", record: r },
      { id: r.id, effective_from: "2018-01-01", record: { ...r, document_version: "2017-03-01", text: `${OLD} ${r.citation}` } },
    ]),
    {
      id: art1b.id,
      effective_from: "2018-01-01",
      record: { ...art1b, document_version: "2017-03-01", text: OLD },
    },
  ],
});

const fileAdapters = createFileAdapters(corpus);
const id = (s: string) => s as RegulationId;

// ── The adapter says which basis it served on ───────────────────────────────────

describe("RegulationAdapter.resolveAsOf (file adapter)", () => {
  const { regulation } = fileAdapters;
  const resolve = (s: string, asOf: string) => regulation.resolveAsOf!(id(s), asOf);

  it("no history, document existed: the current record, on the current basis", async () => {
    const r = await resolve(art1.id, "2019-01-01");
    expect(r.record?.text).toBe(CURRENT);
    expect(r).toMatchObject({ basis: "current" });
  });

  it("a date after everything on a record without history is still the current basis", async () => {
    expect(await resolve(art1.id, "2999-12-31")).toMatchObject({ basis: "current" });
  });

  it("history covering the date: that version, on the history basis", async () => {
    const r = await resolve(art1b.id, "2019-01-01");
    expect(r.record?.text).toBe(OLD);
    expect(r).toMatchObject({ basis: "history" });
  });

  it("the current-boundary history entry is history, not a substitution", async () => {
    const r = await resolve(art1b.id, "2999-12-31");
    expect(r.record?.text).toBe(art1b.text);
    expect(r).toMatchObject({ basis: "history" });
  });

  it("misses carry no basis: history present but the date predates every entry", async () => {
    const r = await resolve(art1b.id, "2010-01-01");
    expect(r.record).toBeNull();
    expect("basis" in r).toBe(false);
  });

  it("misses carry no basis: the date predates the document", async () => {
    const r = await resolve(young.id, "2016-01-01");
    expect(r.record).toBeNull();
    expect("basis" in r).toBe(false);
  });

  it("the boundary date itself is inclusive, on the current basis", async () => {
    expect(await resolve(young.id, "2020-01-01")).toMatchObject({ basis: "current" });
  });

  it("an unknown id is a miss", async () => {
    expect((await resolve("regulation://acme/nope", "2020-01-01")).record).toBeNull();
  });

  it("get(id, asOf) returns exactly the resolved record, over a grid of ids and dates", async () => {
    // `get` delegates to the same logic, so the two cannot disagree. Compared
    // by identity, not by shape: they must be the same object or both null.
    const ids = [art1.id, art1a.id, art1b.id, art1bi.id, young.id, "regulation://acme/nope"];
    const dates = ["1990-01-01", "2012-01-01", "2016-01-01", "2018-01-01", "2020-01-01", "2022-06-01", "2999-12-31"];
    for (const i of ids) {
      for (const d of dates) {
        const got = await regulation.get(id(i), d);
        const resolved = await resolve(i, d);
        expect(got, `${i} @ ${d}`).toBe(resolved.record);
      }
    }
  });
});

// ── The tools over the wire ─────────────────────────────────────────────────────

describe("as_of_note on the regulation tools", () => {
  let client: Client | undefined;
  let saved: RegulationAdapter;

  // The tools read the module-level `adapters`; swap this file's synthetic
  // adapter in and restore the original afterwards, because the module cache is
  // shared with every other test file. Done around EVERY test (not once for the
  // file), so no test depends on which sibling ran before it.
  async function connect(regulation: RegulationAdapter): Promise<void> {
    adapters.regulation = regulation;
    await client?.close();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "as-of-test", version: "0.0.0" });
    await client.connect(clientTransport);
    // Listing caches each tool's output schema, so callTool validates every
    // structured result against what the tool publishes.
    await client.listTools();
  }

  beforeEach(async () => {
    saved = adapters.regulation;
    await connect(fileAdapters.regulation);
  });
  afterEach(async () => {
    adapters.regulation = saved;
    await client?.close();
    client = undefined;
  });

  const wired = (): Client => {
    if (client === undefined) throw new Error("no client connected");
    return client;
  };

  async function call(name: string, args: Record<string, unknown>) {
    const res = await wired().callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return {
      isError: res.isError === true,
      text,
      body: (res.structuredContent ?? {}) as Record<string, unknown>,
    };
  }

  const wire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

  describe("get_regulation", () => {
    it("serves the current text under a date with no recorded version, and says so", async () => {
      const r = await call("get_regulation", { id: art1.id, as_of: "2024-12-31" });
      expect(r.isError).toBe(false);
      const { as_of_note, ...fields } = r.body;
      // Still a hit, and still exactly the current record.
      expect(fields).toEqual(wire(await adapters.regulation.get(id(art1.id))) as Record<string, unknown>);
      expect(fields["text"]).toBe(CURRENT);
      // The note says what the corpus lacks, which version it served, and what not to do.
      expect(typeof as_of_note).toBe("string");
      const note = as_of_note as string;
      expect(note).toContain("2024-12-31");
      expect(note).toContain("2024-05-01"); // document_version of the record served
      expect(note).toContain("document_version");
      expect(note).toMatch(/records no version/i);
      expect(note).toMatch(/may differ from the text in force/i);
      expect(note).toMatch(/not present it as the historical text/i);
      // The same note is in the text block a client reads.
      expect(JSON.parse(r.text).as_of_note).toBe(note);
    });

    it("leads the reply with the note, so a client that truncates the tail still reads it", async () => {
      const r = await call("get_regulation", { id: art1.id, as_of: "2024-12-31" });
      expect(Object.keys(r.body)[0]).toBe("as_of_note");
      expect(Object.keys(JSON.parse(r.text))[0]).toBe("as_of_note");
    });

    it("a date after everything, on a record with no history, is current text with the note", async () => {
      const r = await call("get_regulation", { id: art1.id, as_of: "2999-12-31" });
      expect(r.body["text"]).toBe(CURRENT);
      expect(typeof r.body["as_of_note"]).toBe("string");
    });

    it("carries no note without as_of — the key is absent, not empty", async () => {
      const r = await call("get_regulation", { id: art1.id });
      expect(r.isError).toBe(false);
      expect("as_of_note" in r.body).toBe(false);
    });

    it("carries no note when a recorded version covers the date, and serves that version", async () => {
      const r = await call("get_regulation", { id: art1b.id, as_of: "2019-01-01" });
      expect(r.body["text"]).toBe(OLD);
      expect(r.body["document_version"]).toBe("2017-03-01");
      expect("as_of_note" in r.body).toBe(false);
    });

    it("carries no note for the current-boundary history entry either", async () => {
      const r = await call("get_regulation", { id: art1b.id, as_of: "2999-12-31" });
      expect(r.body["text"]).toBe(art1b.text);
      expect("as_of_note" in r.body).toBe(false);
    });

    it("history present but the date predates every entry is still a miss", async () => {
      const r = await call("get_regulation", { id: art1b.id, as_of: "2010-01-01" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("No version of");
      // The miss says what the same call does elsewhere, so it is not read as
      // "as_of is unsupported" — and the date dropped along with the note.
      expect(r.text).toMatch(/current text is served together with an as_of_note/);
    });

    it("a date before the document existed is still a miss", async () => {
      const r = await call("get_regulation", { id: young.id, as_of: "2016-01-01" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("No version of");
    });

    it("an unknown id is still the plain miss", async () => {
      const r = await call("get_regulation", { id: "regulation://acme/nope", as_of: "2020-01-01" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("No record for");
    });

    it("publishes as_of_note in the output schema without closing it", async () => {
      const { tools } = await wired().listTools();
      const out = tools.find((t) => t.name === "get_regulation")?.outputSchema as
        | { properties?: Record<string, unknown>; additionalProperties?: unknown }
        | undefined;
      expect(out?.properties?.["as_of_note"]).toBeDefined();
      expect(out?.additionalProperties).not.toBe(false);
      // Optional: a response without it must still validate.
      const required = (out as { required?: string[] } | undefined)?.required ?? [];
      expect(required).not.toContain("as_of_note");
    });

    it("the note is in the tool card, so a model learns it exists before it meets one", async () => {
      const { tools } = await wired().listTools();
      for (const name of ["get_regulation", "expand_regulation", "get_regulation_tree"]) {
        expect(tools.find((t) => t.name === name)?.description, name).toContain("as_of_note");
      }
    });
  });

  describe("expand_regulation", () => {
    for (const detail of ["concise", "full"] as const) {
      it(`carries the note next to the record fields (detail: ${detail})`, async () => {
        const r = await call("expand_regulation", { id: art1.id, as_of: "2024-12-31", detail });
        expect(r.isError).toBe(false);
        expect(typeof r.body["as_of_note"]).toBe("string");
        expect(r.body["as_of_note"]).toContain("2024-05-01");
        expect(r.body["text"]).toBe(CURRENT);
        expect(r.body["document_version"]).toBe("2024-05-01");
      });
    }

    it("leads the reply with the note", async () => {
      const r = await call("expand_regulation", { id: art1.id, as_of: "2024-12-31" });
      expect(Object.keys(r.body)[0]).toBe("as_of_note");
    });

    it("carries no note without as_of", async () => {
      expect("as_of_note" in (await call("expand_regulation", { id: art1.id })).body).toBe(false);
    });

    it("carries no note when history covers the record and every regulation child", async () => {
      const r = await call("expand_regulation", { id: art3.id, as_of: "2019-01-01", detail: "full" });
      expect(r.isError).toBe(false);
      expect(r.body["text"]).toContain(OLD);
      expect("as_of_note" in r.body).toBe(false);
      const kids = r.body["children"] as Array<{ record: { text: string; document_version: string } }>;
      expect(kids[0]?.record.document_version).toBe("2017-03-01");
      expect(kids[0]?.record.text).toContain(OLD);
    });

    it("embeds a history-covered child at its recorded version under as_of, not its latest", async () => {
      const r = await call("expand_regulation", { id: art1.id, as_of: "2019-01-01", detail: "full" });
      const kids = r.body["children"] as Array<{ id: string; record: { text: string; document_version: string } }>;
      const b = kids.find((k) => k.id === art1b.id);
      expect(b?.record.text).toBe(OLD);
      expect(b?.record.document_version).toBe("2017-03-01");
      // The child with no history is current text, and the note counts it.
      expect(kids.find((k) => k.id === art1a.id)?.record.text).toBe(`${CURRENT} (a)`);
      const note = r.body["as_of_note"] as string;
      expect(note).toContain("The same holds for 1 of its children");
      expect(note).toContain("2024-05-01");
      // And it agrees with get_regulation on the same child and date.
      const direct = await call("get_regulation", { id: art1b.id, as_of: "2019-01-01" });
      expect(b?.record).toEqual(direct.body as never);
    });

    it("says so when the record is history-covered but a child is current text", async () => {
      // art-1/b has a recorded version for the date; its child art-1/b/i has none.
      for (const detail of ["concise", "full"] as const) {
        const r = await call("expand_regulation", { id: art1b.id, as_of: "2019-01-01", detail });
        expect(r.body["text"], detail).toBe(OLD);
        const note = r.body["as_of_note"] as string;
        expect(typeof note, detail).toBe("string");
        expect(note).toContain("1 child of this provision was served from current text");
        expect(note).toContain("2019-01-01");
        // The record itself is the historical version; the note must not call it current.
        expect(note).not.toContain("document_version (2024-05-01)");
      }
    });

    it("counts several children in the plural", async () => {
      const wide = record("regulation://acme/wide", "Acme Wide", CURRENT, {
        children: ["regulation://acme/art-1/a", "regulation://acme/art-1/b/i"],
      });
      const adapter: RegulationAdapter = {
        ...fileAdapters.regulation,
        search: (q) => fileAdapters.regulation.search(q),
        list: () => fileAdapters.regulation.list(),
        get: (i, asOf) => (i === wide.id ? Promise.resolve(wide as never) : fileAdapters.regulation.get(i, asOf)),
        resolveAsOf: (i, asOf) =>
          i === wide.id
            ? Promise.resolve({ record: wide as never, basis: "history" as const })
            : fileAdapters.regulation.resolveAsOf!(i, asOf),
      };
      await connect(adapter);
      const r = await call("expand_regulation", { id: wide.id, as_of: "2019-01-01" });
      expect(r.body["as_of_note"]).toContain("2 children of this provision were served from current text");
    });

    it("misses are unchanged", async () => {
      expect((await call("expand_regulation", { id: art1b.id, as_of: "2010-01-01" })).isError).toBe(true);
      expect((await call("expand_regulation", { id: young.id, as_of: "2016-01-01" })).isError).toBe(true);
    });

    it("a miss says that current text comes with an as_of_note elsewhere", async () => {
      const r = await call("expand_regulation", { id: art1b.id, as_of: "2010-01-01" });
      expect(r.text).toMatch(/current text is served together with an as_of_note/);
    });
  });

  describe("get_regulation_tree", () => {
    it("puts one note on the root and counts the other nodes served from current text", async () => {
      // art-1 and art-1/a and art-1/b/i have no history; art-1/b is served from it.
      const r = await call("get_regulation_tree", { id: art1.id, as_of: "2019-01-01", detail: "full" });
      expect(r.isError).toBe(false);
      const note = r.body["as_of_note"] as string;
      expect(typeof note).toBe("string");
      expect(note).toContain("2019-01-01");
      expect(note).toContain("2024-05-01");
      expect(note).toContain("2 other provisions");
      // One note, not one per node.
      expect(r.text.match(/as_of_note/g)).toHaveLength(1);
      // The node served from history is still the historical text.
      const root = r.body as unknown as { children: Array<{ id: string; record: { text: string } }> };
      expect(root.children.find((c) => c.id === art1b.id)?.record.text).toBe(OLD);
    });

    it("leads the root envelope with the note", async () => {
      const r = await call("get_regulation_tree", { id: art1.id, as_of: "2019-01-01" });
      expect(Object.keys(r.body)[0]).toBe("as_of_note");
    });

    it("carries the note in the concise form as well", async () => {
      const r = await call("get_regulation_tree", { id: art1.id, as_of: "2019-01-01" });
      expect(r.body["as_of_note"]).toContain("2 other provisions");
      expect("record" in r.body).toBe(false); // still the concise projection
    });

    it("a root of its own, with no other node from current text, gets the plain note", async () => {
      const r = await call("get_regulation_tree", { id: art1a.id, as_of: "2019-01-01" });
      const note = r.body["as_of_note"] as string;
      expect(note).toMatch(/records no version of this provision/i);
      expect(note).not.toMatch(/other provision/i);
    });

    it("says so when only nodes other than the root came from current text", async () => {
      // The root has history for the date; its child art-1/b/i does not.
      const r = await call("get_regulation_tree", { id: art1b.id, as_of: "2019-01-01" });
      const note = r.body["as_of_note"] as string;
      expect(typeof note).toBe("string");
      expect(note).toContain("1 provision in this tree other than the root");
      expect(note).toContain("2019-01-01");
      // The root's own text is the historical version, so the note must not
      // describe the root as current text.
      expect(note).not.toContain("document_version (2024-05-01)");
    });

    it("carries no note when every node came from history, or without as_of", async () => {
      // depth 0 serves the root alone — and the root is history-covered.
      const covered = await call("get_regulation_tree", { id: art1b.id, as_of: "2019-01-01", depth: 0 });
      expect("as_of_note" in covered.body).toBe(false);
      expect("as_of_note" in (await call("get_regulation_tree", { id: art1.id })).body).toBe(false);
    });

    it("misses are unchanged", async () => {
      expect((await call("get_regulation_tree", { id: art1b.id, as_of: "2010-01-01" })).isError).toBe(true);
      expect((await call("get_regulation_tree", { id: young.id, as_of: "2016-01-01" })).isError).toBe(true);
    });

    it("a miss says that current text comes with an as_of_note elsewhere", async () => {
      const r = await call("get_regulation_tree", { id: art1b.id, as_of: "2010-01-01" });
      expect(r.text).toMatch(/current text is served together with an as_of_note/);
    });
  });

  describe("members the corpus lists but has no version of for the date", () => {
    // A child whose recorded history starts after the date, or whose document was
    // published after it, resolves to nothing under as_of. It used to come back as
    // a bare id with a null label - the same shape as a reference to a record the
    // corpus does not hold at all - and the note counted only the children served
    // from current text. The corpus lists these records; it has nothing for the
    // date. That is a gap in its history, and the note says so.
    const DATE = "2016-01-01";
    const gappy = record("regulation://acme/gappy", "Acme Gappy", CURRENT, {
      // art-1/b: history starts 2018. young: its document was published 2020.
      // art-1/a: no history, document existed (current text). dangling: not held.
      children: [art1b.id, young.id, art1a.id, "regulation://acme/dangling"],
    });
    const lone = record("regulation://acme/lone", "Acme Lone", CURRENT, { children: [art1b.id] });
    const rooted = (...roots: Array<typeof gappy>): RegulationAdapter => ({
      ...fileAdapters.regulation,
      get: (i, asOf) => {
        const root = roots.find((r) => r.id === i);
        return root === undefined ? fileAdapters.regulation.get(i, asOf) : Promise.resolve(root as never);
      },
      resolveAsOf: (i, asOf) => {
        const root = roots.find((r) => r.id === i);
        return root === undefined
          ? fileAdapters.regulation.resolveAsOf!(i, asOf)
          : Promise.resolve({ record: root as never, basis: "history" as const });
      },
    });

    beforeEach(async () => {
      await connect(rooted(gappy, lone));
    });

    it("expand_regulation counts the children with no version, apart from the ones served from current text", async () => {
      const r = await call("expand_regulation", { id: gappy.id, as_of: DATE });
      expect(r.isError).toBe(false);
      const note = r.body["as_of_note"] as string;
      expect(typeof note).toBe("string");
      expect(note).toContain("1 child of this provision was served from current text");
      expect(note).toContain("2 children of this provision have no recorded version for the requested as_of date (2016-01-01)");
      expect(note).toContain("listed by id only, with no label or text");
      expect(note).toContain("not evidence that they did not exist or did not apply on that date");
      // The id the corpus does not hold at all is a dangling reference, not a gap.
      expect(note).not.toContain("3 children");
    });

    it("the children without a version are still listed, by id, with no label or record", async () => {
      const concise = await call("expand_regulation", { id: gappy.id, as_of: DATE });
      const stubs = concise.body["children"] as Array<{ id: string; label: string | null }>;
      expect(stubs.map((c) => c.id)).toEqual([art1b.id, young.id, art1a.id, "regulation://acme/dangling"]);
      expect(stubs.map((c) => c.label)).toEqual([null, null, "Acme Article 1(a)", null]);
      const full = await call("expand_regulation", { id: gappy.id, as_of: DATE, detail: "full" });
      const kids = full.body["children"] as Array<{ id: string; record: unknown }>;
      expect(kids.map((c) => c.record === null)).toEqual([true, true, false, true]);
    });

    it("says so when the children with no version are the only thing to say, and in the singular", async () => {
      const r = await call("expand_regulation", { id: lone.id, as_of: DATE });
      const note = r.body["as_of_note"] as string;
      expect(note).toContain("1 child of this provision has no recorded version for the requested as_of date (2016-01-01)");
      expect(note).toContain("it is listed by id only");
      expect(note).not.toContain("served from current text");
      expect(Object.keys(r.body)[0]).toBe("as_of_note");
    });

    it("adds nothing without as_of, or when a recorded version covers every child", async () => {
      expect("as_of_note" in (await call("expand_regulation", { id: lone.id })).body).toBe(false);
      // At 2019 art-1/b has a recorded version, so it is not a gap.
      expect("as_of_note" in (await call("expand_regulation", { id: lone.id, as_of: "2019-01-01" })).body).toBe(false);
    });

    it("get_regulation_tree counts them on the root and says the walk stops there", async () => {
      const r = await call("get_regulation_tree", { id: gappy.id, as_of: DATE });
      expect(r.isError).toBe(false);
      const note = r.body["as_of_note"] as string;
      expect(note).toContain("1 provision in this tree other than the root was served from current text");
      expect(note).toContain("2 provisions in this tree other than the root have no recorded version for the requested as_of date (2016-01-01)");
      expect(note).toContain("by id only, with no label or text, and the walk goes no further there");
      expect(r.text.match(/as_of_note/g)).toHaveLength(1);
      const kids = (r.body as unknown as { children: Array<{ id: string; citation: string }> }).children;
      // A node with nothing to serve is its bare id - the note is what says why.
      expect(kids.find((k) => k.id === young.id)?.citation).toBe(young.id);
    });

    it("get_regulation_tree says it in the singular as well", async () => {
      const note = (await call("get_regulation_tree", { id: lone.id, as_of: DATE })).body["as_of_note"] as string;
      expect(note).toContain("1 provision in this tree other than the root has no recorded version");
      expect(note).toContain("it appears by id only");
    });

    it("an adapter without resolveAsOf is told the same, because the gap is observable from get alone", async () => {
      const legacy: RegulationAdapter = {
        search: (q) => fileAdapters.regulation.search(q),
        get: (i, asOf) => rooted(gappy, lone).get(i, asOf),
        list: () => fileAdapters.regulation.list(),
      };
      await connect(legacy);
      const note = (await call("expand_regulation", { id: lone.id, as_of: DATE })).body["as_of_note"] as string;
      expect(note).toContain("1 child of this provision has no recorded version");
      // ...and still asserts no substitution of its own: nothing here says the root was current text.
      expect(note).not.toContain("served from current text");
    });
  });

  describe("an adapter without resolveAsOf", () => {
    // Adapters outside this repo predate the method. They must keep compiling
    // and keep behaving as before: the record under as_of, and no note — nothing
    // tells the tools the text was substituted, and "unknown" is not asserted as
    // "substituted".
    const legacy: RegulationAdapter = {
      search: (q) => fileAdapters.regulation.search(q),
      get: (i, asOf) => fileAdapters.regulation.get(i, asOf),
      list: () => fileAdapters.regulation.list(),
    };

    // The outer beforeEach connected the file adapter; this one swaps in the
    // legacy wrapper for each test here, and the outer afterEach restores.
    beforeEach(async () => {
      await connect(legacy);
    });

    it("serves the record under as_of with no note, on every tool", async () => {
      const got = await call("get_regulation", { id: art1.id, as_of: "2024-12-31" });
      expect(got.isError).toBe(false);
      expect(got.body["text"]).toBe(CURRENT);
      expect("as_of_note" in got.body).toBe(false);

      // expand and the tree must SUCCEED and serve the record — an error result
      // also has no as_of_note, so absence alone proves nothing.
      const expanded = await call("expand_regulation", { id: art1.id, as_of: "2024-12-31", detail: "full" });
      expect(expanded.isError).toBe(false);
      expect(expanded.body["id"]).toBe(art1.id);
      expect(expanded.body["text"]).toBe(CURRENT);
      expect((expanded.body["children"] as unknown[]).length).toBe(2);
      expect("as_of_note" in expanded.body).toBe(false);

      const tree = await call("get_regulation_tree", { id: art1.id, as_of: "2024-12-31" });
      expect(tree.isError).toBe(false);
      expect(tree.body["id"]).toBe(art1.id);
      expect((tree.body["children"] as unknown[]).length).toBeGreaterThan(0);
      expect("as_of_note" in tree.body).toBe(false);
    });

    it("resolves expand children through get(id, asOf)", async () => {
      const r = await call("expand_regulation", { id: art1.id, as_of: "2019-01-01", detail: "full" });
      expect(r.isError).toBe(false);
      const kids = r.body["children"] as Array<{ id: string; record: { text: string } }>;
      expect(kids.find((k) => k.id === art1b.id)?.record.text).toBe(OLD);
      expect("as_of_note" in r.body).toBe(false);
    });

    it("misses exactly as before", async () => {
      expect((await call("get_regulation", { id: art1b.id, as_of: "2010-01-01" })).isError).toBe(true);
      expect((await call("get_regulation", { id: young.id, as_of: "2016-01-01" })).isError).toBe(true);
    });
  });
});
