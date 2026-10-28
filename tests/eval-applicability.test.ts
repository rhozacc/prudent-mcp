import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { applicabilityIsNeverSilent } from "../evals/invariants.ts";

// ── Eval I20: applicability is never silent ────────────────────────────────────
//
// Run against the real server on a synthetic corpus (it must bind and pass), on corpora that declare nothing (not
// applicable), and against the same server with one tool's replies tampered with (each must fail, fatally): an
// invariant that cannot fail is not measuring anything. Synthetic throughout.

const dir = mkdtempSync(join(tmpdir(), "prudent-i20-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HIST = { status: "historical", until: "2024-12-31", reason: "The old approach was abolished.", replaced_by: ["regulation://acme/new"] };
const SOON = { status: "upcoming", from: "2099-01-01", reason: "Application was postponed." };
const reg = (slug: string, citation: string, extra: Record<string, unknown> = {}) => ({
  id: `regulation://acme/${slug}`,
  framework: "acme",
  document_id: "acme-reg",
  document_version: "2024-05-01",
  citation,
  text: `Synthetic capital text for ${citation}.`,
  ...extra,
});
const playbook = (slug: string, title: string, cites: string, extra: Record<string, unknown> = {}) => ({
  id: `playbook://${slug}`,
  title,
  area: "capital",
  summary: `${title}.`,
  questions: [`What does ${title.toLowerCase()} require?`],
  basis: [{ citation: "Acme", force: "law", role: "r", provisions: [{ id: cites }] }],
  requirements: [{ id: "R1", title: `${title} requirement`, statement: "Show it.", provisions: [{ id: cites }], evidence: [], checks: [], tests: [] }],
  provenance: { status: "approved", compiled_at: "2026-01-01T00:00:00Z", inputs_sha: "0".repeat(64) },
  ...extra,
});
const base = {
  regulation: [reg("old", "Acme Article 1", { applicability: HIST }), reg("new", "Acme Article 2"), reg("soon", "Acme Article 3", { applicability: SOON }), reg("plain", "Acme Article 4")],
  checks: [{ id: "check://acme/old", name: "Old capital check", derived_from: ["regulation://acme/old"], expectation: "e", expected_evidence: [], last_updated: "2024-01-01", applicability: HIST }],
  tests: [{ id: "test://acme/soon", name: "Later capital test", purpose: "p", last_updated: "2024-01-01", applicability: SOON }],
  playbooks: [playbook("old-capital", "Old capital charge", "regulation://acme/old", { applicability: HIST }), playbook("new-capital", "New capital charge", "regulation://acme/new")],
  sources: [{ id: "source://acme/acme-reg", title: "Acme", framework: "acme", document_id: "acme-reg", doc_type: "regulation", status: "current", published: "2010-01-01", verified: new Date().toISOString().slice(0, 10) }],
};

async function open(name: string, content: unknown): Promise<Session> {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(content));
  return openSession({ corpusFile: file });
}

/** The same server, with `tamper` free to rewrite what one tool replies. */
function tampered(s: Session, tamper: (tool: string, args: Record<string, unknown>, body: Record<string, unknown>) => Record<string, unknown>): Session {
  return {
    ...s,
    async call(tool, args = {}): Promise<CallTrace> {
      const t = await s.call(tool, args);
      const body = (t.json ?? t.structured) as Record<string, unknown> | null | undefined;
      if (body === null || body === undefined || typeof body !== "object") return t;
      const next = tamper(tool, args, structuredClone(body));
      return { ...t, json: t.json === null ? null : next, ...(t.structured === undefined ? {} : { structured: next }) };
    },
  };
}
const withoutNotes = (body: Record<string, unknown>, types: string[]): Record<string, unknown> => {
  const kept = ((body["notes"] ?? []) as Array<{ type: string }>).filter((n) => !types.includes(n.type));
  const { notes: _drop, ...rest } = body;
  return kept.length === 0 ? rest : { notes: kept, ...rest };
};
const fatalIds = (r: { findings: Array<{ severity: string; id: string }> }) => r.findings.filter((f) => f.severity === "fatal").map((f) => f.id);

describe("eval I20 on a synthetic corpus", () => {
  it("binds and passes against the real server", async () => {
    const s = await open("declared.json", base);
    try {
      const r = await applicabilityIsNeverSilent(s);
      expect(r.applicable).toBe(true);
      expect(fatalIds(r)).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it("is not applicable when nothing declares anything, or the corpus is empty", async () => {
    for (const [name, content] of [
      ["none.json", { ...base, regulation: base.regulation.map((r) => ({ ...r, applicability: undefined })), checks: [], tests: [], playbooks: [] }],
      ["empty.json", {}],
    ] as const) {
      const s = await open(name, content);
      try {
        const r = await applicabilityIsNeverSilent(s);
        expect(r.applicable, name).toBe(false);
        expect(r.findings, name).toEqual([]);
      } finally {
        await s.close();
      }
    }
  });

  const failing = async (name: string, tamper: Parameters<typeof tampered>[1]): Promise<string[]> => {
    const s = await open(`${name}.json`, base);
    try {
      return fatalIds(await applicabilityIsNeverSilent(tampered(s, tamper)));
    } finally {
      await s.close();
    }
  };

  it("fails a server that is silent on get, related, cite, search, playbook, topics or brief", async () => {
    const silent = (tool: string) => failing(`silent-${tool}`, (t, _a, body) => (t === tool ? withoutNotes(body, ["historical", "upcoming"]) : body));
    expect(await silent("get")).toContain("I20/get");
    expect(await silent("related")).toContain("I20/related");
    expect(await silent("cite")).toContain("I20/cite");
    expect(await silent("search")).toContain("I20/search");
    expect(await silent("playbook")).toContain("I20/playbook");
    expect(await silent("topics")).toContain("I20/topics");
    expect(await silent("brief")).toContain("I20/brief");
  });

  it("fails a note that leaves out the date", async () => {
    const ids = await failing("no-date", (t, _a, body) =>
      t === "get" ? { ...body, notes: ((body["notes"] ?? []) as Array<Record<string, unknown>>).map((n) => ({ ...n, text: "This text no longer applies." })) } : body,
    );
    expect(ids).toContain("I20/get/note");
  });

  it("fails a server that tells a caller asking about a day it applied that it no longer applies", async () => {
    const ids = await failing("as-of-wrong", (t, a, body) =>
      t === "get" && a["as_of"] !== undefined
        ? { ...body, notes: ((body["notes"] ?? []) as Array<Record<string, unknown>>).map((n) => ({ ...n, text: `This text no longer applies: it ceased to apply after 2024-12-31 (${String(a["as_of"])}).` })) }
        : body,
    );
    expect(ids).toContain("I20/get/as_of");
  });

  it("fails a rendered playbook without its banner", async () => {
    const ids = await failing("no-banner", (t, _a, body) => (t === "playbook" && typeof body["text"] === "string" ? { ...body, text: (body["text"] as string).replace(/^> .*\n+/, "") } : body));
    expect(ids).toContain("I20/playbook/banner");
  });

  it("fails a server that flags a provision that declares nothing", async () => {
    const ids = await failing("false-flag", (t, a, body) =>
      t === "get" && a["ids"] === "regulation://acme/plain" ? { notes: [{ type: "historical", text: "This text no longer applies: 2024-12-31.", applies_to: ["x"] }], ...body } : body,
    );
    expect(ids).toContain("I20/false-flag");
  });

  const rewriteNotes = (body: Record<string, unknown>, f: (n: Record<string, unknown>) => Record<string, unknown>) => ({ ...body, notes: ((body["notes"] ?? []) as Array<Record<string, unknown>>).map(f) });

  it("fails a note that names a different entry than the one served", async () => {
    const ids = await failing("other-entry", (t, _a, body) => (t === "get" ? rewriteNotes(body, (n) => ({ ...n, applies_to: ["Something Else"] })) : body));
    expect(ids).toContain("I20/get");
  });

  it("fails a note whose text does not say which entry it concerns", async () => {
    const ids = await failing("anonymous", (t, _a, body) =>
      t === "related" ? rewriteNotes(body, (n) => ({ ...n, text: "This text no longer applies: it ceased to apply after 2024-12-31. Reason: x." })) : body,
    );
    expect(ids).toContain("I20/related/named");
  });

  it("fails a search page or topics note that leaves out the date", async () => {
    const dateless = (tool: string) =>
      failing(`dateless-${tool}`, (t, _a, body) =>
        t === tool ? rewriteNotes(body, (n) => (n["type"] === "historical" || n["type"] === "upcoming" ? { ...n, text: `${(n["applies_to"] as string[]).join("; ")}: does not apply.` } : n)) : body,
      );
    expect(await dateless("search")).toContain("I20/search/note");
    expect(await dateless("topics")).toContain("I20/topics/note");
  });

  it("fails a server that says an upcoming provision applied on a date, or leaves the date out", async () => {
    for (const text of ["This text applied on 2098-12-31, the date asked about.", "This text is not yet in application."]) {
      const ids = await failing("as-of-upcoming", (t, a, body) => (t === "get" && a["as_of"] !== undefined && a["ids"] === "regulation://acme/soon" ? rewriteNotes(body, (n) => ({ ...n, text })) : body));
      expect(ids).toContain("I20/get/as_of");
    }
  });

  it("fails a server that tells a caller a repealed provision applied on a date: the declaration does not say when it started", async () => {
    const ids = await failing("applied-on", (t, a, body) =>
      t === "get" && a["as_of"] === "2024-12-31" ? rewriteNotes(body, (n) => ({ ...n, text: "Acme Article 1 applied on 2024-12-31, the date asked about, but it has since ceased to apply." })) : body,
    );
    expect(ids).toContain("I20/get/as_of");
  });

  it("probes every entry of a kind up to the cap, not the first few", async () => {
    const many = Array.from({ length: 12 }, (_v, i) => reg(`bulk-${i}`, `Acme Bulk ${i}`, { applicability: HIST }));
    const s = await open("many.json", { ...base, regulation: [...base.regulation, ...many] });
    try {
      let silentOn = "";
      const wrapped = tampered(s, (t, a, body) => {
        if (t === "get" && a["ids"] === "regulation://acme/bulk-11") {
          silentOn = String(a["ids"]);
          return withoutNotes(body, ["historical"]);
        }
        return body;
      });
      const r = await applicabilityIsNeverSilent(wrapped);
      expect(silentOn).toBe("regulation://acme/bulk-11");
      expect(fatalIds(r)).toContain("I20/get");
    } finally {
      await s.close();
    }
  });
});
