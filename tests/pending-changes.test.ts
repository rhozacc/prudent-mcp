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
//
// Two documents have open changes, and they are different cases. `acme-reg`'s
// changes name no provision and no amending provision is held: they are the
// document's business and are said at document level (`sources`, a search page's note), never on its provisions. `mapped-reg`
// is amended by `amender-reg`, whose provisions say which of its provisions they
// replace, delete or follow, and one of its changes names a provision by id: only
// the provisions so named are told, and a sibling that nothing names is not.

const rec = (id: string, citation: string, text: string, doc = "acme-reg", framework = "acme") => ({
  id,
  framework,
  document_id: doc,
  document_version: "2024-05-01",
  citation,
  text: `${text} Synthetic default risk wording.`,
});

const M = (n: number) => `regulation://mapped/m-${n}`;
const amending = (n: number, text: string, target: number, op: "replace" | "delete" | "insert_after", effective_from: string) => ({
  ...rec(`regulation://amender/a-${n}`, `Article ${n}`, text, "amender-reg", "amender"),
  amends: [{ target: M(target), op, effective_from }],
});

const regulation = [
  { ...rec("regulation://acme/art-1", "Acme Article 1", "Open article one."), children: ["regulation://acme/art-1/a"] },
  { ...rec("regulation://acme/art-1/a", "Acme Article 1(a)", "Open article one point a."), parent: "regulation://acme/art-1" },
  rec("regulation://acme/art-2", "Acme Article 2", "Open article two."),
  rec(M(1), "Mapped Article 1", "Replaced by an amendment coming.", "mapped-reg", "mapped"),
  rec(M(2), "Mapped Article 2", "Named by a change, with no amending provision held.", "mapped-reg", "mapped"),
  rec(M(3), "Mapped Article 3", "Not named by anything.", "mapped-reg", "mapped"),
  rec(M(4), "Mapped Article 4", "Deleted by an amendment in force.", "mapped-reg", "mapped"),
  rec(M(5), "Mapped Article 5", "Followed by a new provision.", "mapped-reg", "mapped"),
  amending(1, "Mapped Article 1 is replaced by the following: new rule for the first article.", 1, "replace", iso(30)),
  amending(2, "Mapped Article 4 is deleted.", 4, "delete", iso(-10)),
  amending(3, "After Mapped Article 5 the following is inserted: a provision about the fifth.", 5, "insert_after", iso(30)),
  rec("regulation://quiet/q-1", "Quiet paragraph 1", "Quiet document, looked at.", "quiet-doc", "quiet"),
  rec("regulation://silent/s-1", "Silent paragraph 1", "Silent document, never looked at.", "silent-doc", "silent"),
];

const sources = (mappedIngested = false): Source[] => [
  src({
    title: "Acme Regulation",
    pending_changes: [
      change({ title: "Overdue amendment", effective_from: iso(-10), affects: ["Article 1"] }),
      change({ title: "Coming amendment", effective_from: iso(30) }),
      change({ title: "Already folded in", ingested: true, effective_from: iso(-100) }),
    ],
  }),
  src({
    id: "source://mapped/mapped-reg",
    title: "Mapped Regulation",
    framework: "mapped",
    document_id: "mapped-reg",
    pending_changes: [
      change({ title: "Mapped amendment", effective_from: iso(30), ingested: mappedIngested, affects_ids: [M(2) as never] }),
    ],
  }),
  src({ id: "source://amender/amender-reg", title: "Amending Act", framework: "amender", document_id: "amender-reg", pending_changes: [] }),
  src({ id: "source://quiet/quiet-doc", title: "Quiet", framework: "quiet", document_id: "quiet-doc", pending_changes: [] }),
  src({ id: "source://silent/silent-doc", title: "Silent", framework: "silent", document_id: "silent-doc" }),
];

const corpusOf = (mappedIngested = false) => CorpusFileSchema.parse({ regulation, sources: sources(mappedIngested) });
const corpus = corpusOf();

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
  type N = { type: string; text: string; applies_to?: string[] };
  const notesOf = (body: Record<string, unknown>): N[] => (body["notes"] as N[] | undefined) ?? [];
  const amendments = (body: Record<string, unknown>): N[] => notesOf(body).filter((n) => n.type === "amendment");
  /** The amendment note on a served provision, if any. */
  const noteOf = async (id: string, args: Record<string, unknown> = {}): Promise<string | undefined> => {
    const r = await call("get", { ids: id, ...args });
    expect(r.isError).toBe(false);
    return amendments(r.body)[0]?.text;
  };

  describe("get", () => {
    it("a provision an amendment replaces carries the note, leading the body, with the new wording", async () => {
      const r = await call("get", { ids: M(1) });
      expect(Object.keys(r.body)[0]).toBe("notes");
      const [n] = amendments(r.body);
      const note = String(n?.text);
      expect(note.startsWith("Pending change to this provision: ")).toBe(true);
      expect(note).toContain(`Amending Act (Article 1) replaces this provision from ${iso(30)} (in 30 days)`);
      expect(note).toContain("the text below is the version before it");
      expect(note).toContain("New wording: “Mapped Article 1 is replaced by the following: new rule for the first article.");
      expect(n?.applies_to).toEqual(["Mapped Article 1"]);
      expect((r.body["records"] as Array<{ text: string }>)[0]!.text).toContain("Replaced by an amendment coming.");
    });

    it("one an amendment in force deletes says the text may be out of date, leads with it, and gives no new wording", async () => {
      const note = String(await noteOf(M(4)));
      expect(note.startsWith("Text may be out of date: ")).toBe(true);
      expect(note).toContain(`Amending Act (Article 2) has deleted this provision since ${iso(-10)}`);
      expect(note).toContain("may no longer be the text in force");
      expect(note).toContain("deleted, with no new wording");
      expect(note).not.toContain("New wording");
    });

    it("one an amendment adds a provision after says what is added, and that the text itself is unchanged", async () => {
      const note = String(await noteOf(M(5)));
      expect(note).toContain(`inserts a new provision after this one from ${iso(30)}`);
      expect(note).toContain("New provision: “After Mapped Article 5 the following is inserted");
    });

    it("one a change names by id, with no amending provision held, says it in the change's own words", async () => {
      const note = String(await noteOf(M(2)));
      expect(note.startsWith("Pending change to this provision: ")).toBe(true);
      expect(note).toContain(`Mapped amendment applies from ${iso(30)} (in 30 days)`);
      expect(note).toContain("the text below is the version before it");
      expect(note).not.toContain("New wording");
    });

    it("a sibling of the same document that nothing names carries none, though its document has open changes", async () => {
      expect(await noteOf(M(3))).toBeUndefined();
    });

    it("a document whose open changes name no provision says nothing on its provisions", async () => {
      for (const id of ["regulation://acme/art-1", "regulation://acme/art-1/a", "regulation://acme/art-2"]) {
        expect(await noteOf(id), id).toBeUndefined();
      }
    });

    it("says nothing for a document looked at with nothing pending, nor for one never looked at", async () => {
      for (const id of ["regulation://quiet/q-1", "regulation://silent/s-1"]) {
        expect(await noteOf(id), id).toBeUndefined();
      }
    });

    it("says nothing once the document's changes are ingested: the text already carries the amendments", async () => {
      await connect(createFileAdapters(corpusOf(true)));
      for (const n of [1, 2, 4, 5]) expect(await noteOf(M(n)), `m-${n}`).toBeUndefined();
    });

    it("an as_of before an amendment applies leaves it out; the day it applies, it is there", async () => {
      expect(await noteOf(M(1), { as_of: iso(29) })).toBeUndefined();
      expect(await noteOf(M(1), { as_of: iso(30) })).toContain("replaces this provision");
      expect(await noteOf(M(4), { as_of: iso(-11) })).toBeUndefined();
      expect(await noteOf(M(4), { as_of: iso(-10) })).toContain("has deleted this provision");
    });

    it("an as_of before a change that names the provision leaves that out too", async () => {
      expect(await noteOf(M(2), { as_of: iso(29) })).toBeUndefined();
      expect(await noteOf(M(2), { as_of: iso(30) })).toContain("Mapped amendment");
    });

    it("sits beside the version note, which still comes first", async () => {
      const r = await call("get", { ids: M(4), as_of: iso(-5) });
      expect(notesOf(r.body).map((n) => n.type)).toEqual(["version", "amendment"]);
    });

    it("a miss carries no note", async () => {
      const r = await call("get", { ids: "regulation://mapped/nope" });
      expect(r.isError).toBe(true);
      expect(r.text).not.toContain("replaces this provision");
    });
  });

  it("related carries the note for the provision, and none for an unnamed one", async () => {
    const named = await call("related", { id: M(1) });
    expect(amendments(named.body)[0]?.text).toContain("replaces this provision");
    for (const id of [M(3), "regulation://acme/art-1", "regulation://quiet/q-1"]) {
      expect(amendments((await call("related", { id })).body), id).toEqual([]);
    }
  });

  it("cite: a match carries its note, an unnamed match and a decline carry none", async () => {
    const hit = await call("cite", { text: "Mapped Article 1" });
    expect((hit.body["match"] as { id: string }).id).toBe(M(1));
    expect(amendments(hit.body)[0]?.text).toContain("replaces this provision");
    expect(amendments(hit.body)[0]?.applies_to).toEqual(["Mapped Article 1"]);
    const sibling = await call("cite", { text: "Mapped Article 3" });
    expect((sibling.body["match"] as { id: string }).id).toBe(M(3));
    expect(amendments(sibling.body)).toEqual([]);
    const quiet = await call("cite", { text: "Quiet paragraph 1" });
    expect(amendments(quiet.body)).toEqual([]);
    const none = await call("cite", { text: "Acme Article 99" });
    expect(none.body["match"]).toBeNull();
    expect(amendments(none.body)).toEqual([]);
  });

  describe("search", () => {
    it("says a document whose changes name no provision once, and names the provisions that are named, not their document", async () => {
      const r = await call("search", { query: "default risk", limit: 100 });
      const [unmapped, mapped] = amendments(r.body);
      expect(unmapped?.text).toContain("a change its text does not yet include");
      expect(unmapped?.text).toContain("Acme Regulation");
      expect(unmapped?.text.match(/Acme Regulation/g)?.length).toBe(1);
      // The mapped document is not described as a document with a change; its named provisions are named.
      const all = amendments(r.body).map((n) => n.text).join(" ");
      expect(all).not.toContain("Mapped Regulation");
      expect(mapped?.text).toContain("provisions that a recorded change affects");
      // Four are named; the sentence spells out three and counts the rest. The fifth, which nothing names, is not there.
      const cited = [1, 2, 4, 5].filter((n) => mapped!.text.includes(`Mapped Article ${n}`));
      expect(cited).toHaveLength(3);
      expect(mapped?.text).toContain("; and 1 more");
      expect(mapped?.text).not.toContain("Mapped Article 3");
      expect(mapped?.text).toContain("The text shown is the version before it.");
      expect(mapped?.applies_to).toHaveLength(3);
    });

    it("a page of provisions nothing names says nothing about their document's changes", async () => {
      const r = await call("search", { query: "anything" });
      expect((r.body["results"] as Array<{ id: string }>).map((x) => x.id)).toEqual([M(3)]);
      expect(amendments(r.body)).toEqual([]);
    });

    it("one named provision on the page is said in the singular, by citation", async () => {
      const r = await call("search", { query: "coming" });
      expect((r.body["results"] as Array<{ id: string }>).map((x) => x.id)).toEqual([M(1)]);
      expect(amendments(r.body)[0]?.text).toContain("One result is a provision that a recorded change affects: Mapped Article 1.");
    });

    it("keeps the truncation notice beside it instead of replacing it", async () => {
      const r = await call("search", { query: "default risk", limit: 1 });
      expect(String(r.body["notice"]).startsWith("Showing 1 of ")).toBe(true);
    });

    it("is about the rows on the page: a page of quiet rows says nothing", async () => {
      const r = await call("search", { query: "Quiet document" });
      expect(amendments(r.body)).toEqual([]);
    });
  });

  it("sources lists the open changes, urgent first, and omits the ingested one", async () => {
    const r = await call("sources", {});
    const list = r.body["changes"] as Array<{ title: string; state: string }>;
    expect(list.map((c) => [c.title, c.state])).toEqual([
      ["Overdue amendment", "in_force_not_ingested"],
      ["Coming amendment", "upcoming"],
      ["Mapped amendment", "upcoming"],
    ]);
  });

  it("sources: no declaring source means the key is absent; declared and nothing open means []", async () => {
    await connect(createFileAdapters(CorpusFileSchema.parse({ regulation: corpus.regulation, sources: [src()] })));
    expect("changes" in (await call("sources", {})).body).toBe(false);
    await connect(createFileAdapters(CorpusFileSchema.parse({ regulation: corpus.regulation, sources: [src({ pending_changes: [change({ ingested: true })] })] })));
    expect((await call("sources", {})).body["changes"]).toEqual([]);
  });

  it("sources(id) serves each change with the state computed today; the list counts the open ones", async () => {
    const r = await call("sources", { id: "source://acme/acme-reg" });
    const changes = r.body["pending_changes"] as Array<{ title: string; state: string }>;
    expect(changes.map((c) => [c.title, c.state])).toEqual([
      ["Overdue amendment", "in_force_not_ingested"],
      ["Coming amendment", "upcoming"],
      ["Already folded in", "ingested"],
    ]);
    const listed = await call("sources", {});
    const rows = (JSON.parse(listed.text) as { documents: Array<{ id: string; open_changes?: number }> }).documents;
    expect(rows.find((s) => s.id === "source://acme/acme-reg")?.open_changes).toBe(2);
    expect(rows.find((s) => s.id === "source://mapped/mapped-reg")?.open_changes).toBe(1);
    expect("open_changes" in (rows.find((s) => s.id === "source://quiet/quiet-doc") ?? {})).toBe(false);
    // A source that declares nothing is served as stored.
    const silent = await call("sources", { id: "source://silent/silent-doc" });
    expect("pending_changes" in silent.body).toBe(false);
  });

  it("a backend with no sources serves no note", async () => {
    adapters.source = { async list() { return []; }, async get() { return null; } };
    expect(await noteOf(M(1))).toBeUndefined();
  });
});
