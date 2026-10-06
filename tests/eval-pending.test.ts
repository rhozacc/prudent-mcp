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

  it("binds and passes where a change names the provisions it touches, by id or by an amending provision", async () => {
    const siblings = [
      record("regulation://acme/b", "acme-reg", "acme", "Acme 2"),
      record("regulation://acme/c", "acme-reg", "acme", "Acme 3"),
    ];
    // Named by id on the change itself.
    const byId = await run("named-by-id.json", {
      regulation: [...regulation, ...siblings],
      sources: [
        source("acme", "acme-reg", { pending_changes: [{ ...open, affects_ids: ["regulation://acme/a"] }] }),
        source("quiet", "quiet-doc", { pending_changes: [] }),
      ],
    });
    expect(byId.applicable).toBe(true);
    expect(byId.findings.filter((f) => f.severity === "fatal")).toEqual([]);

    // Named only by an amending provision, which the eval reads from the corpus file.
    const amender = {
      ...record("regulation://amender/a-1", "amender-reg", "amender", "Amending 1"),
      amends: [{ target: "regulation://acme/a", op: "replace", effective_from: iso(20) }],
    };
    const byAmends = await run("named-by-amends.json", {
      regulation: [...regulation, ...siblings, amender],
      sources: [
        source("acme", "acme-reg", { pending_changes: [open] }),
        source("amender", "amender-reg", { pending_changes: [] }),
        source("quiet", "quiet-doc", { pending_changes: [] }),
      ],
    });
    expect(byAmends.applicable).toBe(true);
    expect(byAmends.findings.filter((f) => f.severity === "fatal")).toEqual([]);
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

const A = "regulation://acme/a"; // named by the change
const B = "regulation://acme/b"; // a sibling nothing names
const Q = "regulation://quiet/q";
const NOTE = "Pending change to this provision: Amending act applies from " + iso(20) + "; the text below is the version before it.";
const NOTICE =
  "Some results are provisions that a recorded change affects: Acme 1. The text shown is the version before it.";
const DOC_NOTICE =
  "Some results come from a document with a change its text does not yet include. The text shown is the version before it.";

const sourceNamed = (change: Record<string, unknown>, namedIds: string[] | null) => ({
  id: "source://acme/acme-reg", status: "current", document_id: "acme-reg", framework: "acme", title: "t",
  pending_changes: [{ ...change, ...(namedIds === null ? {} : { affects_ids: namedIds }) }],
});
const quietSource = { id: "source://quiet/quiet-doc", status: "current", document_id: "quiet-doc", framework: "quiet", title: "q", pending_changes: [] };
const rowOf = (id: string, citation: string, doc: string) => ({ id, citation, document_id: doc });

/**
 * What a correct server answers when the change names provision A of acme-reg, and
 * B is its sibling. `namedIds: null` is the unmapped case (an explicit undefined would take the default).
 */
function good(
  overrides: Record<string, (args: Record<string, unknown>) => Reply> = {},
  change: Record<string, unknown> = { ...open, state: "upcoming" },
  namedIds: string[] | null = [A],
): Session {
  const acme = sourceNamed(change, namedIds);
  const mapped = namedIds !== null;
  const rows = [rowOf(A, "Acme 1", "acme-reg"), rowOf(B, "Acme 2", "acme-reg"), rowOf(Q, "Quiet 1", "quiet-doc")];
  const noteFor = (id: unknown, args: Record<string, unknown>): Record<string, unknown> =>
    mapped && id === A && args["as_of"] === undefined ? { pending_changes_note: NOTE, id } : { id };
  return stub({
    list_sources: () => ({ json: { sources: [{ id: acme.id }, { id: quietSource.id }] } }),
    get_source: (a) => ({ json: a["id"] === acme.id ? acme : quietSource }),
    get_corpus_info: () => ({ json: { pending_changes: [{ source: acme.id, document_id: "acme-reg", title: "Amending act", state: (change as { state?: string }).state }] } }),
    // Both documents are on every page; the notice says what the named (or unmapped) rows need.
    search_regulation: () => ({ json: { results: rows, notice: mapped ? NOTICE : DOC_NOTICE } }),
    get_regulation: (a) => ({ json: { ...noteFor(a["id"], a), citation: a["id"] === A ? "Acme 1" : "x" } }),
    expand_regulation: (a) => ({ json: noteFor(a["id"], a) }),
    get_regulation_tree: (a) => ({ json: noteFor(a["id"], a) }),
    resolve_citation: () => ({ json: { match: { id: A }, ...(mapped ? { pending_changes_note: NOTE } : {}) } }),
    ...overrides,
  });
}
const fatalIds = (r: { findings: Array<{ severity: string; id: string }> }) => r.findings.filter((f) => f.severity === "fatal").map((f) => f.id);

describe("eval I15 on servers that get it wrong", () => {
  it("passes the correct stand-in, mapped and unmapped (the stand-in is itself honest)", async () => {
    for (const namedIds of [[A], null]) {
      const r = await pendingChangesAreNeverSilent(good({}, { ...open, state: "upcoming" }, namedIds));
      expect(r.applicable).toBe(true);
      expect(fatalIds(r)).toEqual([]);
    }
  });

  it("fails a server that serves a named provision and says nothing, on every tool", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({
        get_regulation: (a) => ({ json: { id: a["id"], citation: "Acme 1" } }),
        expand_regulation: (a) => ({ json: { id: a["id"] } }),
        get_regulation_tree: (a) => ({ json: { id: a["id"] } }),
        resolve_citation: () => ({ json: { match: { id: A } } }),
        search_regulation: () => ({ json: { results: [rowOf(A, "Acme 1", "acme-reg")], notice: "Showing 1 of 9 matches." } }),
        get_corpus_info: () => ({ json: {} }),
      }),
    );
    const ids = fatalIds(r);
    for (const want of ["I15/get_regulation", "I15/expand_regulation", "I15/get_regulation_tree", "I15/resolve_citation", "I15/search", "I15/corpus_info"]) {
      expect(ids, want).toContain(want);
    }
  });

  it("fails a note that omits the date of an upcoming change", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: a["id"] === A && a["as_of"] === undefined ? { pending_changes_note: "Something is pending.", id: a["id"], citation: "Acme 1" } : { id: a["id"] } }) }),
    );
    const f = r.findings.find((x) => x.id === "I15/get_regulation/note");
    expect(f?.severity).toBe("fatal");
    expect(f?.summary).toContain(`does not give the date ${iso(20)}`);
  });

  it("fails a note that does not say an overdue change leaves the text out of date", async () => {
    const overdue = { ...open, effective_from: iso(-4), state: "in_force_not_ingested" };
    const r = await pendingChangesAreNeverSilent(
      good(
        { get_regulation: (a) => ({ json: a["id"] === A && a["as_of"] === undefined ? { pending_changes_note: "Pending change to this provision: Amending act is coming.", id: a["id"], citation: "Acme 1" } : { id: a["id"] } }) },
        overdue,
      ),
    );
    expect(r.findings.some((f) => f.id === "I15/get_regulation/note" && f.summary.includes("out of date"))).toBe(true);
  });

  it("fails a server that puts the note on a sibling nothing names, because its document has an open change", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: NOTE, id: a["id"], citation: "Acme 1" } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/over-flag" && f.severity === "fatal")).toBe(true);
  });

  it("fails a server that puts the note on provisions of a document whose changes name none", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: NOTE, id: a["id"] } }) }, { ...open, state: "upcoming" }, null),
    );
    expect(r.findings.some((f) => f.id === "I15/unmapped-note" && f.severity === "fatal")).toBe(true);
  });

  it("an unmapped document must still be said in the search notice", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ search_regulation: () => ({ json: { results: [rowOf(A, "Acme 1", "acme-reg")], notice: "Showing 1 of 9 matches." } }) }, { ...open, state: "upcoming" }, null),
    );
    expect(r.findings.some((f) => f.id === "I15/search" && f.severity === "fatal")).toBe(true);
  });

  it("fails a server that warns on a provision of a document with nothing open", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: { pending_changes_note: NOTE, id: a["id"], citation: "Acme 1" } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/false-flag" && f.severity === "fatal")).toBe(true);
  });

  it("fails a server that carries the note under an as_of earlier than the change", async () => {
    const r = await pendingChangesAreNeverSilent(
      good({ get_regulation: (a) => ({ json: a["id"] === A ? { pending_changes_note: NOTE, id: a["id"], citation: "Acme 1" } : { id: a["id"] } }) }),
    );
    expect(r.findings.some((f) => f.id === "I15/as_of" && f.severity === "fatal")).toBe(true);
  });

  it("fails a state that the dates do not imply (a change in force served as upcoming)", async () => {
    const wrong = { ...open, effective_from: iso(-4), state: "upcoming" };
    const r = await pendingChangesAreNeverSilent(good({}, wrong));
    expect(r.findings.some((f) => f.id === "I15/state" && f.severity === "fatal")).toBe(true);
  });
});
