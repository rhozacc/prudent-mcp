import { describe, expect, it } from "bun:test";

import { MAX_WORDING_CHARS, amendmentIndex, isMapped, isTargeted, provisionPendingNote } from "../src/amendments.ts";
import { isoDay, openPendingFor } from "../src/pending.ts";
import type { PendingChange, Regulation, Source } from "../src/schema.ts";

// Which provisions an amendment touches, and what a provision says about it. Pure
// over arrays and a date; nothing here reads a corpus. Everything is synthetic.

const DAY = 86_400_000;
const iso = (n: number): string => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const today = isoDay(new Date());

const reg = (id: string, doc: string, over: Partial<Regulation> = {}): Regulation => ({
  id: id as Regulation["id"],
  framework: "eba",
  document_id: doc,
  document_version: "2026-01-01",
  citation: `Paragraph ${id.split("/").pop()}`,
  text: `Text of ${id}.`,
  commentary: [],
  children: [],
  ...over,
});
const P = (n: number) => `regulation://base/p-${n}` as Regulation["id"];

const amender = (n: number, text: string, amends: NonNullable<Regulation["amends"]>, over: Partial<Regulation> = {}): Regulation =>
  reg(`regulation://amender/a-${n}`, "amender-doc", { text, amends, ...over });

const change = (over: Partial<PendingChange> = {}): PendingChange => ({ title: "Amending act", status: "adopted", ingested: false, ...over });
const source = (id: string, doc: string, over: Partial<Source> = {}): Source => ({
  id: id as Source["id"],
  title: `${doc} title`,
  framework: "eba",
  document_id: doc,
  doc_type: "guideline",
  status: "current",
  verified: iso(-1),
  milestones: [],
  ...over,
});
const baseSource = (changes: PendingChange[]) => source("source://eba/base", "base", { title: "Base Guidelines", pending_changes: changes });
const amenderSource = source("source://eba/amender", "amender-doc", { title: "Amending Guidelines", pending_changes: [] });

const base = [reg(P(1), "base"), reg(P(2), "base"), reg(P(3), "base"), reg(P(4), "base")];
const note = (r: Regulation[], s: Source[], id: Regulation["id"], asOf?: string) =>
  provisionPendingNote(r.find((x) => x.id === id)!, r, s, today, asOf);

describe("amendmentIndex", () => {
  const regs = [
    ...base,
    amender(1, "New one.", [{ target: P(1), op: "replace", effective_from: iso(10) }]),
    amender(2, "New two.", [
      { target: P(1), op: "insert_after", effective_from: iso(20) },
      { target: P(2), op: "delete", effective_from: iso(20) },
    ]),
  ];

  it("maps each target to every amendment aimed at it, with the amending provision", () => {
    const idx = amendmentIndex(regs);
    expect(idx.byTarget.get(P(1))?.map((e) => [e.by.id, e.op])).toEqual([
      ["regulation://amender/a-1", "replace"],
      ["regulation://amender/a-2", "insert_after"],
    ]);
    expect(idx.byTarget.get(P(2))?.map((e) => e.op)).toEqual(["delete"]);
    expect(idx.byTarget.has(P(3))).toBe(false);
  });

  it("knows which documents are targeted", () => {
    expect([...amendmentIndex(regs).targetedDocuments]).toEqual(["eba\u0000base"]);
  });

  it("ignores a target that resolves to nothing (the linter's business) and a list with no amends at all", () => {
    const dangling = [...base, amender(1, "x", [{ target: "regulation://base/nope" as never, op: "delete", effective_from: iso(1) }])];
    expect(amendmentIndex(dangling).byTarget.size).toBe(0);
    expect(amendmentIndex(base).byTarget.size).toBe(0);
  });

  it("is built once per list and rebuilt when the list changes", () => {
    const list = [...regs];
    expect(amendmentIndex(list)).toBe(amendmentIndex(list));
    const before = amendmentIndex(list);
    list.push(amender(3, "x", [{ target: P(3), op: "delete", effective_from: iso(5) }]));
    expect(amendmentIndex(list)).not.toBe(before);
    expect(amendmentIndex(list).byTarget.has(P(3))).toBe(true);
  });
});

describe("a document is mapped when something says which of its provisions its open changes touch", () => {
  const open = (r: Regulation[], s: Source[]) => openPendingFor({ framework: "eba", document_id: "base" }, s, today);
  const doc = { framework: "eba", document_id: "base" };

  it("by an amending provision that targets it", () => {
    const r = [...base, amender(1, "x", [{ target: P(1), op: "replace", effective_from: iso(5) }])];
    const s = [baseSource([change({ effective_from: iso(5) })])];
    expect(isMapped(doc, open(r, s), amendmentIndex(r))).toBe(true);
  });

  it("by a change that names provisions by id", () => {
    const s = [baseSource([change({ effective_from: iso(5), affects_ids: [P(2)] })])];
    expect(isMapped(doc, open(base, s), amendmentIndex(base))).toBe(true);
  });

  it("not by a change that only says, in free text, what it concerns", () => {
    const s = [baseSource([change({ effective_from: iso(5), affects: ["paragraphs 1 to 4"] })])];
    expect(isMapped(doc, open(base, s), amendmentIndex(base))).toBe(false);
  });
});

describe("provisionPendingNote", () => {
  const regs = [
    ...base,
    amender(1, "Paragraph 1 is replaced by the following: the new rule.", [{ target: P(1), op: "replace", effective_from: iso(30) }]),
    amender(2, "Paragraph 2 is deleted.", [{ target: P(2), op: "delete", effective_from: iso(-5) }]),
    amender(3, "After paragraph 3 insert the following: an added provision.", [{ target: P(3), op: "insert_after", effective_from: iso(30) }]),
  ];
  const sources = [baseSource([change({ effective_from: iso(30) })]), amenderSource];

  it("says what an upcoming replacement does, by whom, when, and what the new wording is", () => {
    expect(note(regs, sources, P(1))).toBe(
      `Pending change to this provision: Amending Guidelines (Paragraph a-1) replaces this provision from ${iso(30)} (in 30 days); ` +
        "the text below is the version before it. New wording: “Paragraph 1 is replaced by the following: the new rule.”.",
    );
  });

  it("says a deletion in force leaves the text out of date, and that there is no new wording", () => {
    expect(note(regs, sources, P(2))).toBe(
      `Text may be out of date: Amending Guidelines (Paragraph a-2) has deleted this provision since ${iso(-5)}; ` +
        "the text below may no longer be the text in force. It is deleted, with no new wording.",
    );
  });

  it("says an insertion adds a provision after this one, quoting it", () => {
    expect(note(regs, sources, P(3))).toBe(
      `Pending change to this provision: Amending Guidelines (Paragraph a-3) inserts a new provision after this one from ${iso(30)} (in 30 days). ` +
        "New provision: “After paragraph 3 insert the following: an added provision.”.",
    );
  });

  it("says nothing of a sibling no amendment targets, though its document has an open change", () => {
    expect(note(regs, sources, P(4))).toBeUndefined();
  });

  it("says nothing of the amending provisions themselves", () => {
    expect(note(regs, sources, "regulation://amender/a-1" as never)).toBeUndefined();
  });

  it("says nothing once the document's changes are all ingested: the text already carries them", () => {
    const done = [baseSource([change({ effective_from: iso(30), ingested: true })]), amenderSource];
    expect(note(regs, done, P(1))).toBeUndefined();
  });

  it("says nothing for a document with no open change, or none declared, even if provisions are amended", () => {
    expect(note(regs, [baseSource([]), amenderSource], P(1))).toBeUndefined();
    expect(note(regs, [source("source://eba/base", "base"), amenderSource], P(1))).toBeUndefined();
  });

  it("only a CURRENT source speaks for the document", () => {
    const old = [baseSource([change({ effective_from: iso(30) })]), amenderSource].map((s) => (s.document_id === "base" ? { ...s, status: "superseded" as const } : s));
    expect(note(regs, old, P(1))).toBeUndefined();
  });

  it("an as_of before an amendment applies leaves it out; on the day it applies, it is there", () => {
    expect(note(regs, sources, P(1), iso(29))).toBeUndefined();
    expect(note(regs, sources, P(1), iso(30))).toContain("replaces this provision");
    expect(note(regs, sources, P(2), iso(-6))).toBeUndefined();
    expect(note(regs, sources, P(2), iso(-5))).toContain("has deleted this provision");
  });

  it("an amendment's own date decides, not the date on the change record", () => {
    // The change says 30 days out; the amending provision for p-2 says it applied five days ago.
    // As of the day it applied, the text was behind it.
    expect(note(regs, sources, P(2), iso(-5))).toContain("has deleted");
  });

  it("names the amending instrument by its source's title, else by its document id", () => {
    expect(note(regs, sources, P(1))).toContain("Amending Guidelines (");
    expect(note(regs, [sources[0]!], P(1))).toContain("amender-doc (Paragraph a-1)");
  });

  it("quotes the new wording as a quotation, cut at a word and marked, when it is long", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const r = [...base, amender(1, long, [{ target: P(1), op: "replace", effective_from: iso(30) }])];
    const n = provisionPendingNote(r[0]!, r, sources, today)!;
    const quoted = /New wording: “(.*)”\./.exec(n)![1]!;
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(MAX_WORDING_CHARS + 1);
    expect(quoted.slice(0, -1).endsWith(" ")).toBe(false);
    expect(long.startsWith(quoted.slice(0, -1))).toBe(true);
    // A short one is quoted whole, with its whitespace collapsed.
    const short = [...base, amender(1, "Two\n  lines.", [{ target: P(1), op: "replace", effective_from: iso(30) }])];
    expect(provisionPendingNote(short[0]!, short, sources, today)).toContain("“Two lines.”");
  });

  it("says a provision a change names by id, with no amending provision held, in the change's own words", () => {
    const named = [baseSource([change({ title: "Overdue act", effective_from: iso(-3), affects_ids: [P(4)] })])];
    expect(note(base, named, P(4))).toBe(
      `Text may be out of date: Overdue act has applied since ${iso(-3)}; the text below may no longer be the text in force.`,
    );
    expect(note(base, named, P(1))).toBeUndefined();
  });

  it("prefers the amendment, with its wording, over the change that also names the provision", () => {
    const both = [baseSource([change({ effective_from: iso(30), affects_ids: [P(1)] })]), amenderSource];
    const n = note(regs, both, P(1))!;
    expect(n).toContain("New wording");
    expect(n).not.toContain("Amending act applies from");
  });

  it("leads with the amendment already in force, then the soonest, names three and counts the rest", () => {
    const many = [
      ...base,
      amender(1, "one", [{ target: P(1), op: "replace", effective_from: iso(40) }]),
      amender(2, "two", [{ target: P(1), op: "replace", effective_from: iso(10) }]),
      amender(3, "three", [{ target: P(1), op: "delete", effective_from: iso(-2) }]),
      amender(4, "four", [{ target: P(1), op: "replace", effective_from: iso(25) }]),
    ];
    const n = provisionPendingNote(many[0]!, many, sources, today)!;
    expect(n.startsWith("Text may be out of date: ")).toBe(true);
    const at = (s: string) => n.indexOf(s);
    expect(at("(Paragraph a-3) has deleted")).toBeGreaterThan(-1);
    expect(at("(Paragraph a-3)")).toBeLessThan(at("(Paragraph a-2)"));
    expect(at("(Paragraph a-2)")).toBeLessThan(at("(Paragraph a-4)"));
    expect(n).not.toContain("(Paragraph a-1)");
    expect(n.endsWith(" (1 more.)")).toBe(true);
  });
});

describe("isTargeted", () => {
  const regs = [...base, amender(1, "x", [{ target: P(1), op: "replace", effective_from: iso(30) }])];
  const sources = [baseSource([change({ effective_from: iso(30), affects_ids: [P(2)] })])];
  const t = (id: Regulation["id"]) => isTargeted(regs.find((r) => r.id === id)!, regs, sources, today);

  it("is true for a provision an amendment aims at, and for one a change names", () => {
    expect(t(P(1))).toBe(true);
    expect(t(P(2))).toBe(true);
  });

  it("is false for the rest of the document, and for a document with nothing open", () => {
    expect(t(P(3))).toBe(false);
    expect(isTargeted(regs[0]!, regs, [baseSource([])], today)).toBe(false);
  });
});
