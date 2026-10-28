import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { adapters } from "../src/adapters.ts";
import { applicabilityText } from "../src/applicability.ts";
import { CorpusFileSchema, createFileAdapters } from "../src/file-adapter.ts";
import { bannedTermsIn, identifiersIn } from "../src/language.ts";
import { routePlaybooks } from "../src/brief.ts";
import type { Applicability } from "../src/schema.ts";
import { createServer } from "../src/server.ts";

// Applicability is never silent: every tool that serves an entry that no longer applies, or does not apply yet, says so,
// in the library's own words. Everything is synthetic.

const HIST: Applicability = { status: "historical", until: "2024-12-31", reason: "The old approach was abolished", replaced_by: ["regulation://synth/new/1"] };
const SOON: Applicability = { status: "upcoming", from: "2099-01-01", reason: "Application of the new regime was postponed." };
const UNDATED: Applicability = { status: "upcoming", reason: "The date of application has not been set." };

const reg = (slug: string, citation: string, text: string, extra: Record<string, unknown> = {}) => ({
  id: `regulation://synth/${slug}`,
  framework: "synth",
  document_id: "synth-reg",
  document_version: "2024-05-01",
  citation,
  text,
  ...extra,
});

const oldProvision = reg("old/1", "Synth Article 1", "Institutions using the old approach shall hold capital for operational loss, and the old approach capital is computed for operational loss.", { applicability: HIST });
const newProvision = reg("new/1", "Synth Article 2", "Institutions shall hold capital under the new approach for operational loss.");
const soonProvision = reg("later/1", "Synth Article 3", "Institutions shall report market exposure under the later regime.", { applicability: SOON });
const undatedProvision = reg("undated/1", "Synth Article 4", "Institutions shall report counterparty exposure under the undated regime.", { applicability: UNDATED });
const plainProvision = reg("plain/1", "Synth Article 5", "Institutions shall keep documentation of capital models.");

const check = (slug: string, name: string, derived: string[], extra: Record<string, unknown> = {}) => ({
  id: `check://synth/${slug}`,
  name,
  derived_from: derived,
  expectation: `${name} is shown.`,
  expected_evidence: [],
  last_updated: "2024-01-01",
  ...extra,
});

const playbook = (slug: string, title: string, question: string, cites: string, extra: Record<string, unknown> = {}) => ({
  id: `playbook://${slug}`,
  title,
  area: "capital",
  summary: `${title}: what institutions must show.`,
  questions: [question],
  basis: [{ citation: "Synth", force: "law", role: "Sets the requirement.", provisions: [{ id: cites }] }],
  requirements: [{ id: "R1", title: `${title} requirement`, statement: `Show the ${title.toLowerCase()} requirement is met.`, provisions: [{ id: cites }], evidence: [], checks: [], tests: [] }],
  provenance: { status: "approved", compiled_at: "2026-01-01T00:00:00Z", inputs_sha: "0".repeat(64) },
  ...extra,
});

const source = {
  id: "source://synth/synth-reg",
  title: "Synthetic regulation",
  framework: "synth",
  document_id: "synth-reg",
  doc_type: "regulation",
  status: "current",
  published: "2010-01-01",
  verified: new Date().toISOString().slice(0, 10),
};

const corpus = (applicable: boolean) =>
  CorpusFileSchema.parse({
    regulation: [applicable ? oldProvision : { ...oldProvision, applicability: undefined }, newProvision, soonProvision, undatedProvision, plainProvision],
    checks: [
      check("old-check", "Old approach capital check", [oldProvision.id], { applicability: HIST }),
      check("new-check", "New approach capital check", [newProvision.id]),
    ],
    tests: [{ id: "test://synth/old-test", name: "Old approach loss test", purpose: "Tests the old approach loss figure.", last_updated: "2024-01-01", applicability: SOON }],
    playbooks: [
      playbook("old-approach", "Old approach capital", "What did the old approach require for capital?", oldProvision.id, { applicability: HIST }),
      playbook("new-approach", "New approach capital", "What does the new approach require for capital?", newProvision.id),
      playbook("later-regime", "Later regime reporting", "What does the later regime require for reporting?", soonProvision.id, { applicability: SOON }),
    ],
    sources: [source],
    // The old provision's earlier version, held without a declaration of its own: the declaration is the latest one's.
    regulation_history: [{ id: oldProvision.id, effective_from: "2020-01-01", record: { ...oldProvision, document_version: "2019-01-01", applicability: undefined } }],
  });

type N = { type: string; text: string; applies_to?: string[] };

describe("applicability notes", () => {
  let client: Client | undefined;
  let saved: typeof adapters;

  async function connect(applicable = true): Promise<void> {
    Object.assign(adapters, createFileAdapters(corpus(applicable)));
    await client?.close();
    const [c, s] = InMemoryTransport.createLinkedPair();
    await createServer().connect(s);
    client = new Client({ name: "applicability-test", version: "0.0.0" });
    await client.connect(c);
    await client.listTools(); // caches output schemas: every structured result is validated against what the tool publishes
  }
  beforeEach(async () => {
    saved = { ...adapters };
    await connect();
  });
  afterEach(async () => {
    Object.assign(adapters, saved);
    await client?.close();
    client = undefined;
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client!.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    const body = (res.structuredContent ?? {}) as Record<string, unknown>;
    return { isError: res.isError === true, text, body, notes: ((body["notes"] ?? []) as N[]) };
  }
  const of = (notes: N[], type: string) => notes.filter((n) => n.type === type);

  describe("the words", () => {
    it("are domain words: no banned term, no identifier, for every combination", () => {
      const subjects = ["provision", "check", "test", "playbook"] as const;
      for (const a of [HIST, { ...HIST, until: "2999-01-01" } as Applicability, SOON, UNDATED, { ...SOON, from: "2020-01-01" } as Applicability]) {
        for (const subject of subjects) {
          for (const asOf of [undefined, "2023-06-01", "2025-06-01"]) {
            const text = applicabilityText(a, subject, { today: "2026-08-26", asOf, replacedBy: ["Art. 2 Synth"] });
            expect(bannedTermsIn(text)).toEqual([]);
            expect(identifiersIn(text)).toEqual([]);
          }
        }
      }
    });
    it("do not say that text which still applies no longer applies", () => {
      const text = applicabilityText({ ...HIST, until: "2999-01-01" } as Applicability, "provision", { today: "2026-08-26" });
      expect(text).not.toContain("no longer");
      expect(text).toContain("ceasing to apply after 2999-01-01");
    });
    it("say a past `from` is not confirmed rather than that the text applies", () => {
      expect(applicabilityText({ ...SOON, from: "2020-01-01" } as Applicability, "provision", { today: "2026-08-26" })).toContain("not confirmed");
    });
  });

  describe("get", () => {
    it("tells repealed text that it no longer applies, with the date, the reason and the replacement by citation", async () => {
      const r = await call("get", { ids: oldProvision.id });
      const [n] = of(r.notes, "historical");
      expect(n).toBeDefined();
      expect(n!.text).toContain("no longer applies");
      expect(n!.text).toContain("2024-12-31");
      expect(n!.text).toContain("The old approach was abolished.");
      expect(n!.text).toContain(`replaced by ${newProvision.citation}`);
      expect(n!.text).not.toContain("regulation://");
      expect(n!.applies_to).toEqual([oldProvision.citation]);
      expect(Object.keys(r.body)[0]).toBe("notes");
    });

    it("under as_of on or before `until`, says it applied then and has since ceased: from the latest declaration, not the past version's", async () => {
      const r = await call("get", { ids: oldProvision.id, as_of: "2023-06-01" });
      expect((r.body["records"] as Array<{ applicability?: unknown }>)[0]!.applicability).toBeUndefined(); // the 2019 version declares nothing
      const [n] = of(r.notes, "historical");
      expect(n!.text).toContain("applied on 2023-06-01");
      expect(n!.text).toContain("has since ceased to apply");
      expect(n!.text).not.toContain("no longer applies");
    });

    it("under as_of after `until`, says it did not apply then", async () => {
      const r = await call("get", { ids: oldProvision.id, as_of: "2025-06-01" });
      expect(of(r.notes, "historical")[0]!.text).toContain("did not apply on 2025-06-01");
    });

    it("tells an upcoming provision when it starts, or that the date is not fixed", async () => {
      const r = await call("get", { ids: [soonProvision.id, undatedProvision.id] });
      const upcoming = of(r.notes, "upcoming");
      expect(upcoming).toHaveLength(2);
      expect(upcoming.find((n) => n.applies_to?.includes(soonProvision.citation))!.text).toContain("from 2099-01-01");
      expect(upcoming.find((n) => n.applies_to?.includes(undatedProvision.citation))!.text).toContain("not yet fixed");
    });

    it("carries no note on a provision that declares nothing, and no notes key at all", async () => {
      const r = await call("get", { ids: plainProvision.id });
      expect(r.notes).toEqual([]);
      expect("notes" in r.body).toBe(false);
    });

    it("tells a check and a test by name", async () => {
      const r = await call("get", { ids: ["check://synth/old-check", "test://synth/old-test", "check://synth/new-check"] });
      expect(of(r.notes, "historical")[0]!.applies_to).toEqual(["Old approach capital check"]);
      expect(of(r.notes, "upcoming")[0]!.applies_to).toEqual(["Old approach loss test"]);
      expect(r.notes).toHaveLength(2);
    });
  });

  describe("related", () => {
    it("tells the root, and any listed entry that declares it", async () => {
      const root = await call("related", { id: oldProvision.id });
      expect(of(root.notes, "historical")[0]!.applies_to).toContain(oldProvision.citation);
      // The repealed check restating it is listed beside it and is told too.
      expect(of(root.notes, "historical").flatMap((n) => n.applies_to ?? [])).toContain("Old approach capital check");
      const beside = await call("related", { id: newProvision.id });
      expect(of(beside.notes, "historical")).toEqual([]);
    });
    it("tells a check by its own declaration and a playbook that relies on repealed text", async () => {
      const c = await call("related", { id: "check://synth/old-check" });
      expect(of(c.notes, "historical")[0]!.applies_to).toContain("Old approach capital check");
      const p = await call("related", { id: oldProvision.id });
      expect(of(p.notes, "historical").flatMap((n) => n.applies_to ?? [])).toContain("Old approach capital");
    });
  });

  describe("cite", () => {
    it("tells a match that is repealed", async () => {
      const r = await call("cite", { text: "Synth Article 1" });
      expect((r.body["match"] as { id: string }).id).toBe(oldProvision.id);
      expect(of(r.notes, "historical")[0]!.text).toContain("no longer applies");
    });
    it("is silent on a match that declares nothing", async () => {
      const r = await call("cite", { text: "Synth Article 5" });
      expect(r.notes).toEqual([]);
    });
  });

  describe("search", () => {
    it("says once per page which rows are repealed or not yet in application, by citation", async () => {
      const r = await call("search", { query: "institutions capital reporting exposure operational", limit: 50 });
      const rows = r.body["results"] as Array<{ id: string; citation: string }>;
      expect(rows.some((x) => x.id === oldProvision.id)).toBe(true);
      expect(of(r.notes, "historical")).toHaveLength(1);
      expect(of(r.notes, "historical")[0]!.applies_to).toEqual([oldProvision.citation]);
      expect(of(r.notes, "historical")[0]!.text).toContain(oldProvision.citation);
      expect(of(r.notes, "upcoming")).toHaveLength(1);
      expect(of(r.notes, "upcoming")[0]!.applies_to!.sort()).toEqual([soonProvision.citation, undatedProvision.citation]);
    });
    it("names only the rows on the page", async () => {
      const r = await call("search", { query: "institutions capital reporting exposure operational", limit: 1, offset: 4 });
      const rows = r.body["results"] as Array<{ id: string }>;
      const declared = new Set([oldProvision.id, soonProvision.id, undatedProvision.id]);
      expect(r.notes.filter((n) => n.type === "historical" || n.type === "upcoming").length).toBe(rows.some((x) => declared.has(x.id)) ? 1 : 0);
    });
    it("tells checks, tests and playbooks on their own pages", async () => {
      expect(of((await call("search", { query: "approach capital check", scope: "checks" })).notes, "historical")[0]!.applies_to).toEqual(["Old approach capital check"]);
      expect(of((await call("search", { query: "approach loss test", scope: "tests" })).notes, "upcoming")[0]!.applies_to).toEqual(["Old approach loss test"]);
      expect(of((await call("search", { query: "old approach capital", scope: "playbooks" })).notes, "historical")[0]!.applies_to).toEqual(["Old approach capital"]);
    });
    it("ranks repealed text below current law on the same words, and drops nothing", async () => {
      const ids = async (): Promise<{ order: string[]; total: number }> => {
        const r = await call("search", { query: "old approach new approach capital operational loss", limit: 50 });
        return { order: (r.body["results"] as Array<{ id: string }>).map((x) => x.id), total: r.body["total_matches"] as number };
      };
      const without = await (async () => {
        await connect(false);
        return ids();
      })();
      await connect(true);
      const withIt = await ids();
      expect(without.order.indexOf(oldProvision.id)).toBeLessThan(without.order.indexOf(newProvision.id)); // the repealed text matches better ...
      expect(withIt.order.indexOf(newProvision.id)).toBeLessThan(withIt.order.indexOf(oldProvision.id)); // ... and still ranks below current law
      expect(withIt.total).toBe(without.total);
      expect(withIt.order).toContain(oldProvision.id);
    });
  });

  describe("playbook, brief and topics", () => {
    it("playbook: the note on a repealed playbook, and none on a current one", async () => {
      const old = await call("playbook", { id: "old-approach" });
      expect(of(old.notes, "historical").map((n) => n.applies_to)).toEqual([["Old approach capital"]]);
      expect(of(old.notes, "historical")[0]!.text).toContain("requirements in this playbook no longer apply");
      expect((await call("playbook", { id: "new-approach" })).notes).toEqual([]);
    });
    it("playbook: a current playbook is told which of the provisions it rests on no longer apply", async () => {
      Object.assign(adapters, createFileAdapters(CorpusFileSchema.parse({
        ...corpus(true),
        playbooks: [playbook("resting", "Resting on old text", "What rests on the old text?", oldProvision.id)],
      })));
      const r = await call("playbook", { id: "resting" });
      expect(of(r.notes, "historical")[0]!.applies_to).toEqual([oldProvision.citation]);
    });
    it("brief: routes a question about the repealed regime to its playbook, with the note", async () => {
      const r = await call("brief", { question: "What did the old approach require for capital?" });
      expect((r.body["playbook"] as { id: string }).id).toBe("playbook://old-approach");
      expect(of(r.notes, "historical").flatMap((n) => n.applies_to ?? [])).toContain("Old approach capital");
    });
    it("brief: tells a listed provision that is repealed", async () => {
      const r = await call("brief", { question: "capital operational loss institutions" });
      const listed = (r.body["also_relevant"] as Array<{ id: string; citation: string }>).map((x) => x.id);
      if (listed.includes(oldProvision.id)) expect(of(r.notes, "historical").flatMap((n) => n.applies_to ?? [])).toContain(oldProvision.citation);
    });
    it("topics: says which listed playbooks are repealed or not yet in application", async () => {
      const r = await call("topics", {});
      expect(of(r.notes, "historical")[0]!.applies_to).toEqual(["Old approach capital"]);
      expect(of(r.notes, "upcoming")[0]!.applies_to).toEqual(["Later regime reporting"]);
    });
  });
});

describe("routing: a repealed playbook is routed only when it is clearly the best", () => {
  const pb = (slug: string, title: string, extra: Record<string, unknown> = {}) =>
    CorpusFileSchema.parse({
      playbooks: [playbook(slug, title, `What does the ${title.toLowerCase()} require?`, "regulation://synth/x/1", extra)],
    }).playbooks[0]!;
  const a = pb("same-a", "Capital approach");
  const b = pb("same-b", "Capital approach", { applicability: HIST });
  const route = (question: string, list: typeof a[]) => routePlaybooks({ question, playbooks: list, rankedProvisions: [] });

  it("loses a tie to current law", () => {
    const r = route("What does the capital approach require?", [b, a]);
    expect(r.chosen?.playbook.id).toBe(a.id);
    expect(r.routes[1]!.score).toBeLessThan(r.routes[0]!.score);
  });
  it("is still chosen when nothing else matches", () => {
    const r = route("What does the capital approach require?", [b]);
    expect(r.chosen?.playbook.id).toBe(b.id);
  });
  it("leaves playbooks that declare nothing untouched", () => {
    const x = route("What does the capital approach require?", [a]).chosen!.score;
    const y = route("What does the capital approach require?", [a, b]).routes.find((r) => r.playbook.id === a.id)!.score;
    expect(Math.abs(x - y)).toBeLessThan(0.2); // other playbooks move the BM25 yardstick, never the prior
  });
});
