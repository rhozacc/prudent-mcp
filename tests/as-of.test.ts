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

describe("version notes on get", () => {
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

  type Served = { records: Array<Record<string, unknown>>; notes?: Array<{ type: string; text: string; applies_to?: string[] }>; missing?: Array<{ id: string; why: string }> };
  const got = async (ids: string | string[], asOf?: string) => {
    const r = await call("get", { ids, ...(asOf === undefined ? {} : { as_of: asOf }) });
    return { ...r, served: r.body as unknown as Served };
  };
  const versionNotes = (s: Served) => (s.notes ?? []).filter((n) => n.type === "version");

  it("serves the current text under a date with no recorded version, and says so in a version note", async () => {
    const r = await got(art1.id, "2024-12-31");
    expect(r.isError).toBe(false);
    // Still a hit, and still exactly the current record.
    expect(r.served.records[0]).toEqual(JSON.parse(JSON.stringify(await adapters.regulation.get(id(art1.id)))));
    expect(r.served.records[0]!["text"]).toBe(CURRENT);
    const [note] = versionNotes(r.served);
    expect(note).toBeDefined();
    // The note says what the library lacks, which version it served, and what not to do.
    expect(note!.text).toContain("2024-12-31");
    expect(note!.text).toContain("2024-05-01"); // document_version of the record served
    expect(note!.text).toMatch(/version dated 2024-05-01/);
    expect(note!.text).toMatch(/has no version/i);
    expect(note!.text).toMatch(/may differ from the text in force/i);
    expect(note!.text).toMatch(/not present it as the text of that date/i);
    expect(note!.applies_to).toEqual([art1.citation]);
    // The same body is in the text block a client reads.
    expect(JSON.parse(r.text).notes).toEqual(r.served.notes);
  });

  it("leads the reply with the notes, so a client that truncates the tail still reads them", async () => {
    const r = await got(art1.id, "2024-12-31");
    expect(Object.keys(r.served)[0]).toBe("notes");
    expect(Object.keys(JSON.parse(r.text))[0]).toBe("notes");
  });

  it("a date after everything, on a record with no history, is current text with the note", async () => {
    const r = await got(art1.id, "2999-12-31");
    expect(r.served.records[0]!["text"]).toBe(CURRENT);
    expect(versionNotes(r.served)).toHaveLength(1);
  });

  it("carries no notes without as_of: the key is absent, not empty", async () => {
    const r = await got(art1.id);
    expect(r.isError).toBe(false);
    expect("notes" in r.body).toBe(false);
  });

  it("carries no note when a recorded version covers the date, and serves that version", async () => {
    const r = await got(art1b.id, "2019-01-01");
    expect(r.served.records[0]!["text"]).toBe(OLD);
    expect(r.served.records[0]!["document_version"]).toBe("2017-03-01");
    expect("notes" in r.body).toBe(false);
  });

  it("carries no note for the current-boundary history entry either", async () => {
    const r = await got(art1b.id, "2999-12-31");
    expect(r.served.records[0]!["text"]).toBe(art1b.text);
    expect("notes" in r.body).toBe(false);
  });

  it("history present but the date predates every entry is still a miss, and says what the same call does elsewhere", async () => {
    const r = await got(art1b.id, "2010-01-01");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("has no version of");
    // So it is not read as "as_of is unsupported" and the date dropped along with the note.
    expect(r.text).toMatch(/current text is returned together with a note saying so/);
  });

  it("a date before the document existed is still a miss", async () => {
    const r = await got(young.id, "2016-01-01");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("has no version of");
  });

  it("an unknown id is a miss that says what the library holds of that document", async () => {
    const r = await got("regulation://acme/nope", "2020-01-01");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/regulation:\/\/acme\/nope/);
  });

  it("a batch serves what it can and lists the rest as missing, with the reason", async () => {
    const r = await got([art1.id, art1b.id, young.id], "2016-01-01");
    // art-1 has no history and its document existed: current text. art-1/b history starts 2018 and young is later: gaps.
    expect(r.isError).toBe(false);
    expect(r.served.records.map((x) => x["id"])).toEqual([art1.id]);
    expect(r.served.missing?.map((m) => m.id)).toEqual([art1b.id, young.id]);
    expect(r.served.missing![0]!.why).toMatch(/no version of this provision in force on 2016-01-01/);
    expect(versionNotes(r.served)).toHaveLength(1);
  });

  it("one version note says it once for a batch that shares it, with every citation it applies to", async () => {
    const r = await got([art1.id, art1a.id], "2024-12-31");
    // The two notes differ only in the citation, not in the wording a user needs; each is a note of its own because
    // the version dated differs per record only by the word 'provision' - identical text merges.
    const notes = versionNotes(r.served);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.flatMap((n) => n.applies_to ?? []).sort()).toEqual([art1.citation, art1a.citation].sort());
  });

  it("publishes notes in the output schema without closing it", async () => {
    const { tools } = await wired().listTools();
    const out = tools.find((t) => t.name === "get")?.outputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown; required?: string[] } | undefined;
    expect(out?.properties?.["notes"]).toBeDefined();
    expect(out?.additionalProperties).not.toBe(false);
    expect(out?.required ?? []).not.toContain("notes");
  });

  it("related reads amendments as of the date and serves a provision whose version note is current text", async () => {
    const r = await call("related", { id: art1.id, as_of: "2024-12-31" });
    expect(r.isError).toBe(false);
    expect(r.body["id"]).toBe(art1.id);
  });

  describe("an adapter without resolveAsOf", () => {
    // Adapters outside this repo predate the method. They must keep compiling
    // and keep behaving as before: the record under as_of, and no note: nothing
    // tells the tools the text was substituted, and "unknown" is not asserted as
    // "substituted".
    const legacy: RegulationAdapter = {
      search: (q) => fileAdapters.regulation.search(q),
      get: (i, asOf) => fileAdapters.regulation.get(i, asOf),
      list: () => fileAdapters.regulation.list(),
    };

    beforeEach(async () => {
      await connect(legacy);
    });

    it("serves the record under as_of with no note", async () => {
      const r = await got(art1.id, "2024-12-31");
      expect(r.isError).toBe(false);
      expect(r.served.records[0]!["text"]).toBe(CURRENT);
      expect("notes" in r.body).toBe(false);
    });

    it("serves a history-covered record at its recorded version", async () => {
      const r = await got(art1b.id, "2019-01-01");
      expect(r.served.records[0]!["text"]).toBe(OLD);
      expect("notes" in r.body).toBe(false);
    });

    it("misses exactly as before", async () => {
      expect((await got(art1b.id, "2010-01-01")).isError).toBe(true);
      expect((await got(young.id, "2016-01-01")).isError).toBe(true);
    });
  });
});
