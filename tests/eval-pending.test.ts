import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { pendingChangesAreNeverSilent } from "../evals/invariants.ts";

// ── Eval I15: a pending change is never silent ─────────────────────────────────
//
// Run against a real server on a synthetic corpus (it must pass and bind), on
// corpora with nothing open and with nothing at all (not applicable), and against
// stand-in sessions replaying servers that stay silent, always warn, or serve a
// state the dates do not imply (each must fail, fatally): an invariant that cannot
// fail is not measuring anything. Synthetic throughout.

const dir = mkdtempSync(join(tmpdir(), "prudent-i15-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const iso = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const day = "2024-05-01";

const record = (id: string, document_id: string, framework: string, citation: string) => ({
  id, framework, document_id, document_version: day, citation, text: `Synthetic default risk text for ${citation}.`,
});
const source = (framework: string, document_id: string, extra: Record<string, unknown> = {}) => ({
  id: `source://${framework}/${document_id}`, title: `${document_id} title`, framework, document_id,
  doc_type: "regulation", status: "current", verified: iso(-1), ...extra,
});

const regulation = [
  record("regulation://acme/a", "acme-reg", "acme", "Acme 1"),
  record("regulation://quiet/q", "quiet-doc", "quiet", "Quiet 1"),
];
const open = { title: "Amending act", status: "adopted", ingested: false, effective_from: iso(20) };
const withOpen = {
  regulation,
  sources: [source("acme", "acme-reg", { pending_changes: [open] }), source("quiet", "quiet-doc", { pending_changes: [] })],
};

async function run(name: string, content: unknown) {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(content));
  const session = await openSession({ corpusFile: file });
  try {
    return await pendingChangesAreNeverSilent(session);
  } finally {
    await session.close();
  }
}

describe("eval I15 on a synthetic corpus", () => {
  it("binds and passes against a server that says so, upcoming or already in force", async () => {
    for (const effective_from of [iso(20), iso(-9)]) {
      const r = await run(`open-${effective_from}.json`, {
        regulation,
        sources: [source("acme", "acme-reg", { pending_changes: [{ ...open, effective_from }] }), source("quiet", "quiet-doc", { pending_changes: [] })],
      });
      expect(r.applicable).toBe(true);
      expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    }
  });

  it("an undated change binds too", async () => {
    const { effective_from: _omit, ...undated } = open;
    const r = await run("undated.json", { regulation, sources: [source("acme", "acme-reg", { pending_changes: [undated] })] });
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when nothing is open, or the corpus is empty", async () => {
    for (const [name, content] of [
      ["quiet.json", { regulation, sources: [source("acme", "acme-reg", { pending_changes: [{ ...open, ingested: true }] })] }],
      ["undeclared.json", { regulation, sources: [source("acme", "acme-reg")] }],
      ["empty.json", {}],
    ] as const) {
      const r = await run(name, content);
      expect(r.applicable, name).toBe(false);
      expect(r.findings, name).toEqual([]);
    }
  });
});

// ── Stand-ins: servers that get it wrong ────────────────────────────────────────

type Reply = { json?: unknown; isError?: boolean };
function stub(handlers: Record<string, (args: Record<string, unknown>) => Reply>): Session {
  const trace = (tool: string, args: Record<string, unknown>, reply: Reply): CallTrace => ({
    tool, args, text: JSON.stringify(reply.json ?? null), chars: 0, tokens: 0, ms: 0, isError: reply.isError === true, json: reply.json,
  });
  return {
    tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
    async close() {},
    async call(tool, args = {}) {
      const h = handlers[tool];
      return trace(tool, args, h === undefined ? { isError: true } : h(args));
    },
  };
}

const NOTE =
  "Pending change to this document: Amending act applies from " + iso(20) + " and is not ingested here, so the text served is the version before it.";

/** What a correct server answers for the synthetic registry above. */
function good(overrides: Record<string, (args: Record<string, unknown>) => Reply> = {}): Session {
  const acme = { id: "source://acme/acme-reg", status: "current", document_id: "acme-reg", framework: "acme", title: "t", pending_changes: [{ ...open, state: "upcoming" }] };
  const quiet = { id: "source://quiet/quiet-doc", status: "current", document_id: "quiet-doc", framework: "quiet", title: "q", pending_changes: [] };
  const rowsFor = (doc: string) => ({
    results: [{ id: doc === "acme-reg" ? "regulation://acme/a" : "regulation://quiet/q", citation: doc === "acme-reg" ? "Acme 1" : "Quiet 1", document_id: doc }],
  });
  return stub({
    list_sources: () => ({ json: { sources: [{ id: acme.id }, { id: quiet.id }] } }),
    get_source: (a) => ({ json: a["id"] === acme.id ? acme : quiet }),
    get_corpus_info: () => ({ json: { pending_changes: [{ source: acme.id, document_id: "acme-reg", title: "Amending act", state: "upcoming" }] } }),
    search_regulation: () => ({
      // The stand-in holds both documents on every page; the notice names the open one.
      json: { ...{ results: [...rowsFor("acme-reg").results, ...rowsFor("quiet-doc").results] }, notice: "Some results come from a change this corpus has not ingested." },
    }),
    get_regulation: (a) => ({ json: a["id"] === "regulation://acme/a" && a["as_of"] === undefined ? { pending_changes_note: NOTE, id: a["id"] } : { id: a["id"] } }),
    expand_regulation: (a) => ({ json: a["id"] === "regulation://acme/a" ? { pending_changes_note: NOTE, id: a["id"] } : { id: a["id"] } }),
    get_regulation_tree: (a) => ({ json: a["id"] === "regulation://acme/a" ? { pending_changes_note: NOTE, id: a["id"] } : { id: a["id"] } }),
    resolve_citation: () => ({ json: { match: { id: "regulation://acme/a" }, pending_changes_note: NOTE } }),
    ...overrides,
  });
}

describe("eval I15 on servers that get it wrong", () => {
  it("passes the correct stand-in (the stand-in is itself honest)", async () => {
    const r = await pendingChangesAreNeverSilent(good());
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("fails a server that serves the record and says nothing, on every tool", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({
        get_regulation: (a) => ({ json: { id: a["id"] } }),
        expand_regulation: (a) => ({ json: { id: a["id"] } }),
        get_regulation_tree: (a) => ({ json: { id: a["id"] } }),
        resolve_citation: () => ({ json: { match: { id: "regulation://acme/a" } } }),
        search_regulation: () => ({ json: { results: [{ id: "regulation://acme/a", citation: "Acme 1", document_id: "acme-reg" }], notice: "Showing 1 of 9 matches." } }),
        get_corpus_info: () => ({ json: {} }),
      }),
    );
    const ids = r.findings.filter((f) => f.severity === "fatal").map((f) => f.id);
    for (const want of ["I15/get_regulation", "I15/expand_regulation", "I15/get_regulation_tree", "I15/resolve_citation", "I15/search", "I15/corpus_info"]) {
      expect(ids, want).toContain(want);
    }
  });

  it("fails a note that does not name the change, or omits the date", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: "Something is pending.", id: a["id"] } }) }),
    );
    const f = r.findings.find((x) => x.id === "I15/get_regulation/note");
    expect(f?.severity).toBe("fatal");
    expect(f?.summary).toContain('does not name "Amending act"');
    expect(f?.summary).toContain(`does not give the date ${iso(20)}`);
  });

  it("fails a note that does not say an overdue change leaves the text out of date", async () => {
    const overdue = { ...open, effective_from: iso(-4), state: "in_force_not_ingested" };
    const acme = { id: "source://acme/acme-reg", status: "current", document_id: "acme-reg", framework: "acme", title: "t", pending_changes: [overdue] };
    const r = await pendingChangesAreNeverSilent(
      good({
        get_source: (a) => ({ json: a["id"] === acme.id ? acme : { id: "source://quiet/quiet-doc", status: "current", document_id: "quiet-doc", framework: "quiet", title: "q", pending_changes: [] } }),
        get_regulation: (a) => ({ json: { pending_changes_note: "Pending change to this document: Amending act is coming.", id: a["id"] } }),
      }),
    );
    expect(r.findings.some((f) => f.id === "I15/get_regulation/note" && f.summary.includes("out of date"))).toBe(true);
  });

  it("fails a server that warns on a record of a document with nothing open", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: NOTE, id: a["id"] } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/false-flag" && f.severity === "fatal")).toBe(true);
  });

  it("fails a server that carries the note under an as_of earlier than the change", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: NOTE, id: a["id"] } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/as_of" && f.severity === "fatal")).toBe(true);
  });

  it("fails a state that the dates do not imply (a change in force served as upcoming)", async () => {
    const wrong = { ...open, effective_from: iso(-4), state: "upcoming" };
    const acme = { id: "source://acme/acme-reg", status: "current", document_id: "acme-reg", framework: "acme", title: "t", pending_changes: [wrong] };
    const r = await pendingChangesAreNeverSilent(
      good({ get_source: (a) => ({ json: a["id"] === acme.id ? acme : { id: "source://quiet/quiet-doc", status: "current", document_id: "quiet-doc", framework: "quiet", title: "q", pending_changes: [] } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/state" && f.severity === "fatal")).toBe(true);
  });
});
