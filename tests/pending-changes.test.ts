import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { adapters } from "../src/adapters.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import {
  declaresPendingChanges,
  isoDay,
  openPendingChanges,
  openPendingFor,
  pendingChangeSummaries,
  pendingChangeWarnings,
  pendingChangesNote,
  pendingSearchNotice,
  pendingState,
} from "../src/pending.ts";
import type { PendingChange, Source } from "../src/schema.ts";
import { createServer } from "../src/server.ts";
import { corpusInfo, corpusWarnings } from "../src/validate.ts";

// ── A pending change is never silent ───────────────────────────────────────────
//
// The registry knows something the snapshot does not: an amendment adopted and not
// yet applying, or one in force since the text was ingested. A text that has been
// overtaken reads exactly like one that has not, so the server says so beside the
// record, from what the registry stores and today's date. Everything here is
// synthetic; no real instrument appears.

const DAY = 86_400_000;
/** An ISO day `n` days from today (negative: in the past). */
const iso = (n: number): string => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const today = isoDay(new Date());

const change = (over: Partial<PendingChange> = {}): PendingChange => ({
  title: "Amending act",
  status: "adopted",
  ingested: false,
  ...over,
});

const src = (over: Partial<Source> = {}): Source => ({
  id: "source://acme/acme-reg",
  title: "Acme Regulation",
  framework: "acme",
  document_id: "acme-reg",
  doc_type: "regulation",
  status: "current",
  verified: iso(-1),
  milestones: [],
  ...over,
});

// ── The state arithmetic ────────────────────────────────────────────────────────

describe("pendingState", () => {
  it("an ingested change is quiet whatever its date", () => {
    expect(pendingState(change({ ingested: true, effective_from: iso(30) }), today)).toBe("ingested");
    expect(pendingState(change({ ingested: true, effective_from: iso(-30) }), today)).toBe("ingested");
    expect(pendingState(change({ ingested: true }), today)).toBe("ingested");
  });

  it("no date recorded: undated", () => {
    expect(pendingState(change(), today)).toBe("undated");
  });

  it("ahead of today: upcoming; the day itself and after: in force", () => {
    expect(pendingState(change({ effective_from: iso(1) }), today)).toBe("upcoming");
    expect(pendingState(change({ effective_from: today }), today)).toBe("in_force_not_ingested");
    expect(pendingState(change({ effective_from: iso(-1) }), today)).toBe("in_force_not_ingested");
  });
});

describe("openPendingChanges", () => {
  it("only CURRENT sources speak for a document, and only changes not ingested are open", () => {
    const sources = [
      src({ pending_changes: [change({ title: "open", effective_from: iso(10) }), change({ title: "done", ingested: true })] }),
      src({ id: "source://acme/old", status: "superseded", superseded_by: "source://acme/acme-reg", pending_changes: [change({ title: "ghost" })] }),
      src({ id: "source://acme/next", status: "pending", pending_changes: [change({ title: "ghost 2" })] }),
    ];
    expect(openPendingChanges(sources, today).map((o) => o.change.title)).toEqual(["open"]);
  });

  it("most urgent first: already in force, then soonest, then undated", () => {
    const open = openPendingChanges(
      [
        src({
          pending_changes: [
            change({ title: "undated" }),
            change({ title: "later", effective_from: iso(90) }),
            change({ title: "sooner", effective_from: iso(10) }),
            change({ title: "overdue", effective_from: iso(-5) }),
          ],
        }),
      ],
      today,
    );
    expect(open.map((o) => o.change.title)).toEqual(["overdue", "sooner", "later", "undated"]);
  });
});

describe("absent is not empty", () => {
  it("no source declaring the field means no corpus-wide list at all", () => {
    expect(declaresPendingChanges([src()])).toBe(false);
    expect(pendingChangeSummaries([src()])).toBeUndefined();
  });

  it("[] is a statement (looked, nothing pending): an empty list, not an absent one", () => {
    expect(declaresPendingChanges([src({ pending_changes: [] })])).toBe(true);
    expect(pendingChangeSummaries([src({ pending_changes: [] })])).toEqual([]);
  });

  it("the list holds open changes only and names the source and document", () => {
    const list = pendingChangeSummaries(
      [src({ pending_changes: [change({ title: "A", reference: "R-1", effective_from: iso(5) }), change({ title: "B", ingested: true })] })],
    );
    expect(list).toEqual([
      { source: "source://acme/acme-reg", document_id: "acme-reg", title: "A", reference: "R-1", status: "adopted", effective_from: iso(5), state: "upcoming" },
    ]);
  });
});

describe("openPendingFor", () => {
  const sources = [
    src({ pending_changes: [change({ title: "dated", effective_from: iso(30) }), change({ title: "undated" })] }),
    src({ id: "source://other/doc", framework: "other", document_id: "doc", pending_changes: [change({ title: "elsewhere" })] }),
  ];

  it("joins on framework + document_id, nothing else", () => {
    expect(openPendingFor({ framework: "acme", document_id: "acme-reg" }, sources, today).map((o) => o.change.title)).toEqual(["dated", "undated"]);
    expect(openPendingFor({ framework: "acme", document_id: "doc" }, sources, today)).toEqual([]);
    expect(openPendingFor({ framework: "other", document_id: "acme-reg" }, sources, today)).toEqual([]);
  });

  it("under a date before the change applied, that change is left out; an undated one stays", () => {
    const doc = { framework: "acme", document_id: "acme-reg" };
    expect(openPendingFor(doc, sources, today, iso(10)).map((o) => o.change.title)).toEqual(["undated"]);
    expect(openPendingFor(doc, sources, today, iso(30)).map((o) => o.change.title)).toEqual(["dated", "undated"]);
  });
});

// ── The words ───────────────────────────────────────────────────────────────────

const noteFor = (changes: PendingChange[]): string | undefined =>
  pendingChangesNote(openPendingChanges([src({ pending_changes: changes })], today), today);

describe("pendingChangesNote", () => {
  it("says nothing when nothing is open: no note, never an empty one", () => {
    expect(noteFor([])).toBeUndefined();
    expect(noteFor([change({ ingested: true })])).toBeUndefined();
  });

  it("an upcoming adopted change: the date, the distance, and that the text below is the version before it", () => {
    const note = noteFor([change({ title: "Amending act A", effective_from: iso(17) })]) ?? "";
    expect(note).toContain("Pending change to this document");
    expect(note).toContain(`applies from ${iso(17)} (in 17 days)`);
    expect(note).toContain("the text below is the version before it");
    expect(note).toContain("the version before it");
    expect(note).not.toContain("out of date");
  });

  it("tomorrow, and a date far ahead with no day count", () => {
    expect(noteFor([change({ effective_from: iso(1) })])).toContain("(tomorrow)");
    expect(noteFor([change({ effective_from: iso(400) })])).not.toContain("(in ");
  });

  it("a change already in force and not ingested says the text may be out of date, and leads with it", () => {
    const note = noteFor([change({ title: "Amending act B", effective_from: iso(-3) })]) ?? "";
    expect(note.startsWith("Text may be out of date: ")).toBe(true);
    expect(note).toContain(`has applied since ${iso(-3)}`);
    expect(note).toContain("may no longer be the text in force");
  });

  it("an announced change is expected, not applying; an overdue announced one is not claimed to apply", () => {
    expect(noteFor([change({ status: "announced", effective_from: iso(20) })])).toContain("is expected to apply from");
    const overdue = noteFor([change({ status: "announced", effective_from: iso(-20) })]) ?? "";
    expect(overdue).toContain("was expected to apply from");
    expect(overdue).not.toContain("has applied");
  });

  it("no date recorded: says so and claims no date", () => {
    const note = noteFor([change({ status: "announced" })]) ?? "";
    expect(note).toContain("is announced with no application date recorded");
    expect(note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("quotes the registry's affects hint (capped) and never parses it", () => {
    const note = noteFor([change({ affects: ["para 23(d)", "paras 31-32", "x", "y", "z"] })]) ?? "";
    expect(note).toContain("Said to concern para 23(d); paras 31-32; x; y; ....");
  });

  it("does not repeat a reference the title already carries, and adds one it lacks", () => {
    expect(noteFor([change({ title: "Amending act R-9", reference: "R-9" })])).not.toContain("(R-9)");
    expect(noteFor([change({ title: "Amending act", reference: "R-9" })])).toContain("Amending act (R-9)");
  });

  it("names at most three and counts the rest", () => {
    const note =
      noteFor(Array.from({ length: 5 }, (_, i) => change({ title: `Change ${i + 1}`, effective_from: iso(10 + i) }))) ?? "";
    expect(note).toContain("Change 1");
    expect(note).toContain("Change 3");
    expect(note).not.toContain("Change 4");
    expect(note).toContain("(2 more.)");
  });
});

describe("pendingSearchNotice", () => {
  const open = (c: PendingChange) => openPendingChanges([src({ pending_changes: [c] })], today);

  it("says nothing for a page with nothing open", () => {
    expect(pendingSearchNotice([])).toBeUndefined();
    expect(pendingSearchNotice([{ title: "Quiet", open: [] }])).toBeUndefined();
  });

  it("names the document and the change once, and says the text shown is the version before it", () => {
    const n = pendingSearchNotice([{ title: "Acme Regulation", open: open(change({ title: "Amending act", effective_from: iso(9) })) }]) ?? "";
    expect(n).toContain("Acme Regulation (Amending act, from " + iso(9) + ")");
    expect(n).toContain("does not yet include");
    expect(n).toContain("version before it");
  });

  it("an overdue one reads as applied, an undated one as no date recorded", () => {
    expect(pendingSearchNotice([{ title: "D", open: open(change({ title: "T", effective_from: iso(-2) })) }])).toContain("applied " + iso(-2));
    expect(pendingSearchNotice([{ title: "D", open: open(change({ title: "T" })) }])).toContain("no date recorded");
  });
});

describe("the linter", () => {
  const withBehind = [src({ pending_changes: [change({ title: "Overdue", effective_from: iso(-4) }), change({ title: "Ahead", effective_from: iso(40) })] })];

  it("warns, never fails, about a change in force that is not ingested", () => {
    expect(pendingChangeWarnings(withBehind)).toEqual([
      `source://acme/acme-reg: Overdue has applied since ${iso(-4)} but is not ingested — the text this corpus serves for the document is out of date`,
    ]);
    expect(pendingChangeWarnings([src({ pending_changes: [change({ effective_from: iso(40) })] })])).toEqual([]);
  });

  it("corpusWarnings carries it and corpusInfo counts the open ones, in force or not", () => {
    const corpus = { regulation: [], tests: [], checks: [], playbooks: [], sources: withBehind };
    expect(corpusWarnings(corpus).some((w) => w.includes("Overdue has applied"))).toBe(true);
    expect(corpusInfo(corpus).some((l) => l.includes("2 pending change(s)") && l.includes("1 already in force"))).toBe(true);
    expect(corpusInfo({ ...corpus, sources: [src({ pending_changes: [change({ ingested: true })] })] }).some((l) => l.includes("pending"))).toBe(false);
  });
});

// ── The tools over the wire ─────────────────────────────────────────────────────

const rec = (id: string, citation: string, text: string, doc = "acme-reg", framework = "acme") => ({
  id,
  framework,
  document_id: doc,
  document_version: "2024-05-01",
  citation,
  text: `${text} Synthetic default risk wording.`,
});

const corpus = CorpusFileSchema.parse({
  regulation: [
    { ...rec("regulation://acme/art-1", "Acme Article 1", "Open article one."), children: ["regulation://acme/art-1/a"] },
    { ...rec("regulation://acme/art-1/a", "Acme Article 1(a)", "Open article one point a."), parent: "regulation://acme/art-1" },
    rec("regulation://acme/art-2", "Acme Article 2", "Open article two."),
    rec("regulation://quiet/q-1", "Quiet paragraph 1", "Quiet document, looked at.", "quiet-doc", "quiet"),
    rec("regulation://silent/s-1", "Silent paragraph 1", "Silent document, never looked at.", "silent-doc", "silent"),
  ],
  sources: [
    src({
      title: "Acme Regulation",
      pending_changes: [
        change({ title: "Overdue amendment", effective_from: iso(-10), affects: ["Article 1"] }),
        change({ title: "Coming amendment", effective_from: iso(30) }),
        change({ title: "Already folded in", ingested: true, effective_from: iso(-100) }),
      ],
    }),
    src({ id: "source://quiet/quiet-doc", title: "Quiet", framework: "quiet", document_id: "quiet-doc", pending_changes: [] }),
    src({ id: "source://silent/silent-doc", title: "Silent", framework: "silent", document_id: "silent-doc" }),
  ],
});

describe("the pending-change signal on the tools", () => {
  let client: Client | undefined;
  let saved: typeof adapters;

  async function connect(file: ReturnType<typeof createFileAdapters>): Promise<void> {
    adapters.regulation = file.regulation;
    adapters.source = file.source;
    adapters.meta = file.meta;
    await client?.close();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "pending-test", version: "0.0.0" });
    await client.connect(clientTransport);
    // Listing caches each tool's output schema, so callTool validates every
    // structured result against what the tool publishes.
    await client.listTools();
  }

  beforeEach(async () => {
    saved = { ...adapters };
    await connect(createFileAdapters(corpus));
  });
  afterEach(async () => {
    Object.assign(adapters, saved);
    await client?.close();
    client = undefined;
  });

  async function call(name: string, args: Record<string, unknown>) {
    if (client === undefined) throw new Error("no client");
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    return { isError: res.isError === true, text, body: (res.structuredContent ?? {}) as Record<string, unknown> };
  }

  describe("get_regulation", () => {
    it("carries the note, leading the body, for a document with open changes", async () => {
      const r = await call("get_regulation", { id: "regulation://acme/art-2" });
      expect(r.isError).toBe(false);
      expect(Object.keys(r.body)[0]).toBe("pending_changes_note");
      const note = String(r.body["pending_changes_note"]);
      expect(note.startsWith("Text may be out of date: ")).toBe(true);
      expect(note).toContain("Overdue amendment");
      expect(note).toContain("Coming amendment");
      expect(note).toContain(`applies from ${iso(30)} (in 30 days)`);
      expect(note).not.toContain("Already folded in");
      expect(r.body["text"]).toContain("Open article two.");
    });

    it("says nothing for a document looked at with nothing pending, nor for one never looked at", async () => {
      for (const id of ["regulation://quiet/q-1", "regulation://silent/s-1"]) {
        const r = await call("get_regulation", { id });
        expect(r.isError).toBe(false);
        expect("pending_changes_note" in r.body, id).toBe(false);
      }
    });

    it("an as_of before a change applied leaves that change out; before all of them, no note at all", async () => {
      const mid = await call("get_regulation", { id: "regulation://acme/art-2", as_of: iso(-5) });
      const note = String(mid.body["pending_changes_note"]);
      expect(note).toContain("Overdue amendment");
      expect(note).not.toContain("Coming amendment");
      const early = await call("get_regulation", { id: "regulation://acme/art-2", as_of: iso(-20) });
      expect(early.isError).toBe(false);
      expect("pending_changes_note" in early.body).toBe(false);
    });

    it("sits beside the as_of_note, which still comes first", async () => {
      const r = await call("get_regulation", { id: "regulation://acme/art-2", as_of: iso(-5) });
      const keys = Object.keys(r.body);
      expect(keys[0]).toBe("as_of_note");
      expect(keys[1]).toBe("pending_changes_note");
    });

    it("a miss carries no note", async () => {
      const r = await call("get_regulation", { id: "regulation://acme/nope" });
      expect(r.isError).toBe(true);
      expect(r.text).not.toContain("pending_changes_note");
    });
  });

  it("expand_regulation and get_regulation_tree carry the note for the root's document", async () => {
    const expanded = await call("expand_regulation", { id: "regulation://acme/art-1" });
    expect(String(expanded.body["pending_changes_note"])).toContain("Overdue amendment");
    const tree = await call("get_regulation_tree", { id: "regulation://acme/art-1" });
    expect(String(tree.body["pending_changes_note"])).toContain("Overdue amendment");
    const quiet = await call("expand_regulation", { id: "regulation://quiet/q-1" });
    expect("pending_changes_note" in quiet.body).toBe(false);
  });

  it("resolve_citation: a match carries the note, a decline carries none", async () => {
    const hit = await call("resolve_citation", { text: "Acme Article 2" });
    expect((hit.body["match"] as { id: string }).id).toBe("regulation://acme/art-2");
    expect(String(hit.body["pending_changes_note"])).toContain("Overdue amendment");
    const quiet = await call("resolve_citation", { text: "Quiet paragraph 1" });
    expect((quiet.body["match"] as { id: string } | null)?.id).toBe("regulation://quiet/q-1");
    expect("pending_changes_note" in quiet.body).toBe(false);
    const none = await call("resolve_citation", { text: "Acme Article 99" });
    expect(none.body["match"]).toBeNull();
    expect("pending_changes_note" in none.body).toBe(false);
  });

  describe("search_regulation", () => {
    it("adds one sentence to the notice when the page holds rows of such a document", async () => {
      const r = await call("search_regulation", { query: "default risk" });
      const notice = String(r.body["notice"]);
      expect(notice).toContain("a change its text does not yet include");
      expect(notice).toContain("Acme Regulation");
      expect(notice.match(/Acme Regulation/g)?.length).toBe(1);
    });

    it("appends it after the truncation notice instead of replacing it", async () => {
      const r = await call("search_regulation", { query: "default risk", limit: 1 });
      const notice = String(r.body["notice"]);
      expect(notice.startsWith("Showing 1 of ")).toBe(true);
      expect(notice).toContain("does not yet include");
    });

    it("is about the rows on the page: a page of quiet rows says nothing", async () => {
      const r = await call("search_regulation", { query: "Quiet document" });
      expect(String(r.body["notice"] ?? "")).not.toContain("does not yet include");
    });
  });

  it("get_corpus_info lists the open changes, urgent first, and omits the ingested one", async () => {
    const r = await call("get_corpus_info", {});
    const list = r.body["pending_changes"] as Array<{ title: string; state: string }>;
    expect(list.map((c) => [c.title, c.state])).toEqual([
      ["Overdue amendment", "in_force_not_ingested"],
      ["Coming amendment", "upcoming"],
    ]);
  });

  it("get_corpus_info: no declaring source means the key is absent; declared and nothing open means []", async () => {
    await connect(createFileAdapters(CorpusFileSchema.parse({ regulation: corpus.regulation, sources: [src()] })));
    expect("pending_changes" in (await call("get_corpus_info", {})).body).toBe(false);
    await connect(createFileAdapters(CorpusFileSchema.parse({ regulation: corpus.regulation, sources: [src({ pending_changes: [change({ ingested: true })] })] })));
    expect((await call("get_corpus_info", {})).body["pending_changes"]).toEqual([]);
  });

  it("get_source serves each change with the state computed today; list_sources counts the open ones", async () => {
    const r = await call("get_source", { id: "source://acme/acme-reg" });
    const changes = r.body["pending_changes"] as Array<{ title: string; state: string }>;
    expect(changes.map((c) => [c.title, c.state])).toEqual([
      ["Overdue amendment", "in_force_not_ingested"],
      ["Coming amendment", "upcoming"],
      ["Already folded in", "ingested"],
    ]);
    const listed = await call("list_sources", {});
    // Read the serialized body: `undefined`-valued keys drop out of it, as they do on a real wire.
    const rows = (JSON.parse(listed.text) as { sources: Array<{ id: string; open_pending_changes?: number }> }).sources;
    expect(rows.find((s) => s.id === "source://acme/acme-reg")?.open_pending_changes).toBe(2);
    expect("open_pending_changes" in (rows.find((s) => s.id === "source://quiet/quiet-doc") ?? {})).toBe(false);
    // A source that declares nothing is served as stored.
    const silent = await call("get_source", { id: "source://silent/silent-doc" });
    expect("pending_changes" in silent.body).toBe(false);
  });

  it("a backend with no registry serves no note", async () => {
    adapters.source = { async list() { return []; }, async get() { return null; } };
    const r = await call("get_regulation", { id: "regulation://acme/art-2" });
    expect(r.isError).toBe(false);
    expect("pending_changes_note" in r.body).toBe(false);
  });
});
