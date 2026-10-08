import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEMO_COMPILED_PLAYBOOKS, DEMO_TOPICS, demoPlaybookContext } from "../examples/inmemory-demo.ts";
import { citationOf, locatorOf } from "../src/citation-style.ts";
import { playbookContext, type PlaybookContext } from "../src/playbook-context.ts";
import { verifyPlaybook, type Verification } from "../src/playbook-verify.ts";
import { basisCitation, forceLabel, renderPlaybook } from "../src/render.ts";
import {
  CitationStyleSchema,
  PlaybookSchema,
  LegacyPlaybookSchema,
  PlaybookSchema,
  TopicsSchema,
  type Playbook,
  type Regulation,
  type RegulationId,
  type Source,
} from "../src/schema.ts";

const demo = (): Playbook => structuredClone(PlaybookSchema.parse(DEMO_COMPILED_PLAYBOOKS["playbook://pd-long-run-average"]));
const ctx = (): PlaybookContext => demoPlaybookContext();
const MEMBERS: RegulationId[] = [
  "regulation://crr/180",
  "regulation://crr/180/1/a",
  "regulation://eba/gl-2017-16/78",
  "regulation://eba/gl-2017-16/s4",
];
const verify = (pb: Playbook, c: PlaybookContext = ctx(), members: readonly RegulationId[] = MEMBERS): Verification => verifyPlaybook(pb, c, { members });
const rules = (v: Verification): string[] => v.errors.map((f) => f.rule);

/** The demo context plus provisions of the demo documents the demo playbook does not cite. */
function withExtra(...extra: Partial<Regulation>[]): PlaybookContext {
  const base = ctx();
  const regs = new Map(base.regulations);
  for (const e of extra) {
    const reg = { document_version: "2017-11-20", commentary: [], children: [], ...e } as Regulation;
    regs.set(reg.id, reg);
  }
  return { ...base, regulations: regs };
}

const source = (style: Source["citation_style"]): Source => ({
  id: "source://x/y",
  title: "x",
  framework: "x",
  document_id: "y",
  doc_type: "guideline",
  status: "current",
  verified: "2026-01-01",
  milestones: [],
  ...(style === undefined ? {} : { citation_style: style }),
});

describe("the compiled playbook schema", () => {
  test("the demo playbook and topics parse", () => {
    expect(() => PlaybookSchema.parse(DEMO_COMPILED_PLAYBOOKS["playbook://pd-long-run-average"])).not.toThrow();
    expect(() => TopicsSchema.parse(DEMO_TOPICS)).not.toThrow();
  });

  test("the 0.x playbook keeps working under both names until 1.0.0", () => {
    expect(LegacyPlaybookSchema).toBe(PlaybookSchema);
  });

  test("a requirement needs a handle and a provision; a quote is bounded", () => {
    const base = demo();
    expect(PlaybookSchema.safeParse({ ...base, requirements: [{ ...base.requirements[0]!, id: "req1" }] }).success).toBe(false);
    expect(PlaybookSchema.safeParse({ ...base, requirements: [{ ...base.requirements[0]!, provisions: [] }] }).success).toBe(false);
    const long = { ...base.basis[0]!, provisions: [{ id: "regulation://crr/180/1/a", quote: "x".repeat(301) }] };
    expect(PlaybookSchema.safeParse({ ...base, basis: [long] }).success).toBe(false);
    expect(PlaybookSchema.safeParse({ ...base, questions: [] }).success).toBe(false);
  });

  test("a citation style may carry the document's short name", () => {
    expect(CitationStyleSchema.parse({ kind: "eba-gl", short_name: "EBA/GL/2017/16" }).short_name).toBe("EBA/GL/2017/16");
    expect(CitationStyleSchema.parse({ kind: "generic" }).short_name).toBeUndefined();
  });
});

describe("citationOf", () => {
  test("a regulation's article, with its pinpoint", () => {
    const s = source({ kind: "eu-regulation", short_name: "CRR" });
    expect(citationOf({ citation: "Article 179(1)(d)" }, s)).toBe("Art. 179(1)(d) CRR");
    expect(citationOf({ citation: "CRR Article 180 ( 1 ) ( a )" }, s)).toBe("Art. 180(1)(a) CRR");
    expect(citationOf({ citation: "Art. 105.13" }, s)).toBe("Art. 105.13 CRR");
  });

  test("a guideline's paragraph", () => {
    const s = source({ kind: "eba-gl", short_name: "EBA/GL/2017/16" });
    expect(citationOf({ citation: "Paragraph 28" }, s)).toBe("EBA/GL/2017/16 para 28");
    expect(citationOf({ citation: "EBA GL 2017/16 paragraph 78" }, s)).toBe("EBA/GL/2017/16 para 78");
  });

  test("the ECB guide leads with its chapter's name", () => {
    const s = source({ kind: "ecb-guide", short_name: "ECB guide to internal models", chapters: { "3": "Model validation" } });
    expect(citationOf({ citation: "Chapter 3, paragraph 233" }, s)).toBe("ECB guide to internal models, Model validation chapter, para 233");
    // a chapter the style does not name is still cited correctly, by number
    expect(citationOf({ citation: "Chapter 9, paragraph 4" }, s)).toBe("ECB guide to internal models, Ch. 9 para 4");
  });

  test("it never guesses: no style, no short name, or no pinpoint gives the record's own citation", () => {
    expect(citationOf({ citation: "Paragraph 28" })).toBe("Paragraph 28");
    expect(citationOf({ citation: "Paragraph 28" }, source(undefined))).toBe("Paragraph 28");
    expect(citationOf({ citation: "Paragraph 28" }, source({ kind: "eba-gl" }))).toBe("Paragraph 28");
    expect(citationOf({ citation: "Section 4.2" }, source({ kind: "eba-gl", short_name: "EBA/GL/2017/16" }))).toBe("Section 4.2");
    expect(citationOf({ citation: "Annex II" }, source({ kind: "eu-regulation", short_name: "CRR" }))).toBe("Annex II");
    expect(citationOf({ citation: "Para 3" }, source({ kind: "generic", short_name: "X" }))).toBe("Para 3");
  });

  test("locators compare places, not spellings", () => {
    expect(locatorOf("CRR Article 180(1)(a)")).toBe("art:180(1)(a)");
    expect(locatorOf("Art. 180 (1) (A)")).toBe("art:180(1)(a)");
    expect(locatorOf("Paragraph 28")).toBe("para:28");
    expect(locatorOf("Chapter 4, paragraph 26")).toBe("ch4.para:26");
    expect(locatorOf("Section 4.2")).toBeNull();
  });
});

describe("renderPlaybook", () => {
  const golden = "tests/golden/pd-long-run-average.md";
  test("the demo playbook renders to the pinned text", () => {
    const text = renderPlaybook(demo(), ctx())!.text + "\n";
    if (process.env["UPDATE_GOLDEN"] === "1" || !existsSync(golden)) writeFileSync(golden, text);
    expect(text).toBe(readFileSync(golden, "utf8"));
  });

  test("deterministic: the same playbook renders to the same bytes", () => {
    expect(renderPlaybook(demo(), ctx())!.text).toBe(renderPlaybook(demo(), ctx())!.text);
  });

  test("no internal id, and no word the language rule bans, reaches the text", () => {
    const text = renderPlaybook(demo(), ctx())!.text;
    expect(text).not.toMatch(/\b(?:regulation|check|test|playbook|source):\/\//);
    expect(text).not.toMatch(/\b(corpus|ingest\w*|registry|records?)\b/i);
  });

  test("force is labelled by issuer, and market practice says so", () => {
    const text = renderPlaybook(demo(), ctx())!.text;
    expect(text).toContain("(law)");
    expect(text).toContain("(EBA guideline)");
    expect(text).toContain("market practice, not a regulatory requirement");
    expect(forceLabel("supervisory_expectation", "ecb")).toBe("ECB supervisory expectation");
    expect(forceLabel("supervisory_expectation", "eba")).toBe("supervisory expectation");
    expect(forceLabel("delegated_act")).toBe("delegated act");
  });

  test("a citation comes from the id; the compiler's own is kept only where it adds a pinpoint", () => {
    const pb = demo();
    const entry = pb.basis[0]!; // provision crr/180/1/a -> "Art. 180(1)(a) CRR"
    expect(basisCitation(entry, ctx())).toBe("Art. 180(1)(a) CRR");
    // the compiler wrote a different article for the same provision: the id wins
    expect(basisCitation({ ...entry, citation: "Art. 179(1)(d) CRR" }, ctx())).toBe("Art. 180(1)(a) CRR");
    // a pinpoint deeper than the id's own record is kept
    const c = withExtra({ id: "regulation://crr/174", framework: "crr", document_id: "crr", citation: "Article 174", text: "x" });
    expect(basisCitation({ ...entry, citation: "Art. 174(c) CRR", provisions: [{ id: "regulation://crr/174" }] }, c)).toBe("Art. 174(c) CRR");
    expect(basisCitation({ ...entry, citation: "Art. 175 CRR", provisions: [{ id: "regulation://crr/174" }] }, c)).toBe("Art. 174 CRR");
    // "Art. 1740" is another article, not a pinpoint of 174
    expect(basisCitation({ ...entry, citation: "Art. 1740 CRR", provisions: [{ id: "regulation://crr/174" }] }, c)).toBe("Art. 174 CRR");
    // no provisions: nothing to derive from, so what the compiler wrote
    expect(basisCitation({ ...entry, provisions: [] }, ctx())).toBe("Art. 180(1)(a) CRR");
  });

  test("past the budget the later requirements are shortened, each saying how to ask for it", () => {
    const full = renderPlaybook(demo(), ctx())!;
    expect(full.abridged).toEqual([]);
    const tight = renderPlaybook(demo(), ctx(), { budget: full.tokens - 40 })!;
    expect(tight.abridged).toEqual(["R2"]);
    expect(tight.text).toContain("### R1. Estimate PDs by grade");
    expect(tight.text).toContain("Derive each grade's PD"); // R1 is still in full
    expect(tight.text).not.toContain("Show that the average used as the calibration target");
    expect(tight.text).toContain("Ask for section R2 to see it in full.");
    expect(tight.tokens).toBeLessThan(full.tokens);
  });

  test("a requirement section carries the full text of its provisions and the check's own words", () => {
    const r = renderPlaybook(demo(), ctx(), { section: "R2" })!;
    expect(r.text).toContain("### EBA/GL/2017/16 para 78");
    expect(r.text).toContain("including downturn periods relevant to the portfolio.");
    expect(r.text).toContain("Calibration tests are performed at the level at which PDs are assigned");
    expect(r.abridged).toEqual([]);
  });

  test("an unknown section is null, not an empty page", () => {
    expect(renderPlaybook(demo(), ctx(), { section: "R9" })).toBeNull();
  });

  test("a long provision is cut at a sentence end and says so", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} says something about the data.`).join(" ");
    const c = withExtra({ id: "regulation://eba/gl-2017-16/78", framework: "eba", document_id: "eba-gl-2017-16", citation: "EBA GL 2017/16 paragraph 78", text: long });
    const r = renderPlaybook(demo(), c, { section: "R2", budget: 300 })!;
    expect(r.abridged).toEqual(["EBA/GL/2017/16 para 78"]);
    expect(r.text).toContain("[Cut for length.]");
    expect(r.text).toMatch(/says something about the data\. \[Cut for length\.\]/);
  });

  test("a provision the context does not hold is left out, never printed as an id", () => {
    const pb = demo();
    pb.requirements[0]!.provisions.push({ id: "regulation://nowhere/1" });
    const text = renderPlaybook(pb, ctx())!.text;
    expect(text).not.toContain("nowhere");
    expect(text).toContain("Sources: Art. 180(1)(a) CRR.");
  });
});

describe("verifyPlaybook", () => {
  test("the demo playbook is clean", () => {
    expect(verify(demo())).toEqual({ errors: [], warnings: [] });
  });

  test("V1: a provision, a check, a test, an excluded id and a related playbook that do not resolve", () => {
    const pb = demo();
    pb.requirements[0]!.provisions.push({ id: "regulation://crr/9999" });
    pb.requirements[0]!.checks.push("check://nope");
    pb.requirements[1]!.tests.push("test://nope");
    pb.excluded.push({ id: "regulation://crr/9998", reason: "x" });
    pb.related.push("playbook://nope");
    const v = verify(pb);
    expect(v.errors.filter((f) => f.rule === "V1").map((f) => f.message.replace(/.*: /, ""))).toEqual(
      expect.arrayContaining(["regulation://crr/9999", "check://nope", "test://nope", "regulation://crr/9998", "playbook://nope"]),
    );
  });

  test("V2: a quote the provision does not say, and one over 300 characters", () => {
    const pb = demo();
    pb.basis[0]!.provisions[0]!.quote = "Institutions shall estimate PDs from short-run averages.";
    expect(verify(pb).errors.map((f) => `${f.rule} ${f.where}`)).toEqual(["V2 basis[0].provisions[0].quote"]);
    const long = demo();
    long.basis[1]!.provisions[0]!.quote = "when calibrating PDs ".repeat(20);
    expect(rules(verify(long))).toContain("V2");
  });

  test("V2: whitespace is normalised, wording is not", () => {
    const pb = demo();
    pb.basis[0]!.provisions[0]!.quote = "Institutions   shall estimate PDs\nby obligor grade";
    expect(verify(pb).errors).toEqual([]);
    pb.basis[0]!.provisions[0]!.quote = "institutions shall estimate PDs by obligor grade";
    expect(rules(verify(pb))).toEqual(["V2"]);
  });

  test("V3: prose names a held provision that this passage does not cite", () => {
    const c = withExtra({ id: "regulation://eba/gl-2017-16/79", framework: "eba", document_id: "eba-gl-2017-16", citation: "EBA GL 2017/16 paragraph 79", text: "More." });
    const pb = demo();
    pb.requirements[0]!.statement += " Paragraph 79 adds a further condition.";
    const v = verify(pb, c, MEMBERS);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatchObject({ rule: "V3", where: "requirements.R1.statement" });
    // cited by the same requirement: fine; cited by the basis: fine
    pb.requirements[0]!.provisions.push({ id: "regulation://eba/gl-2017-16/79" });
    expect(verify(pb, c, MEMBERS).errors).toEqual([]);
  });

  test("V3: a range names every provision in it; an article is matched by its pinpoint; a quotation is not a claim", () => {
    const c = withExtra(
      { id: "regulation://eba/gl-2017-16/79", framework: "eba", document_id: "eba-gl-2017-16", citation: "EBA GL 2017/16 paragraph 79", text: "More." },
      { id: "regulation://eba/gl-2017-16/80", framework: "eba", document_id: "eba-gl-2017-16", citation: "EBA GL 2017/16 paragraph 80", text: "More." },
    );
    const range = demo();
    range.pitfalls[0]!.text = "See paragraphs 78-80 together.";
    expect(verify(range, c, MEMBERS).errors.map((f) => f.message)).toEqual([expect.stringContaining("para 79"), expect.stringContaining("para 80")]);

    const art = demo();
    art.pitfalls[0]!.text = "Do not confuse this with Art. 178(1)(b).";
    expect(verify(art, ctx(), MEMBERS).errors[0]).toMatchObject({ rule: "V3", where: "pitfalls[0].text" });
    // a container of what is cited is the same place, and an instrument that is not held is not checked at all
    const ok = demo();
    ok.pitfalls[0]!.text = "Art. 180 CRR applies; so does Art. 999 of another regulation, which is not held.";
    expect(verify(ok, ctx(), MEMBERS).errors).toEqual([]);

    const quoted = demo();
    quoted.pitfalls[0]!.text = 'The text says "see Art. 178(1)(b)" and the answer does not rely on it.';
    expect(verify(quoted, ctx(), MEMBERS).errors).toEqual([]);
  });

  test("V4: a member provision neither cited nor excluded with a reason", () => {
    const pb = demo();
    pb.excluded = pb.excluded.filter((e) => e.id !== "regulation://eba/gl-2017-16/s4");
    const v = verify(pb);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatchObject({ rule: "V4" });
    expect(v.errors[0]!.message).toContain("Section 4");
    // a reason is required, not just a listing
    pb.excluded.push({ id: "regulation://eba/gl-2017-16/s4", reason: "  " });
    expect(rules(verify(pb))).toEqual(["V4"]);
    // no member list, no completeness check
    expect(verifyPlaybook(pb, ctx()).errors).toEqual([]);
  });

  test("V5: banned words, identifiers and self-reference in prose; abbreviations and quotations are not", () => {
    const words = demo();
    words.requirements[0]!.statement += " The corpus holds this and the registry says so.";
    expect(verify(words).errors.filter((f) => f.rule === "V5").map((f) => f.message)).toEqual(['uses "corpus"', 'uses "registry"']);

    const ident = demo();
    ident.pitfalls[0]!.text += " Look it up with get_regulation.";
    expect(verify(ident).errors.map((f) => f.message)).toEqual(["contains an identifier: get_regulation"]);

    const self = demo();
    self.summary += " The library holds more.";
    expect(rules(verify(self))).toEqual(["V5"]);

    const plumbing = demo();
    plumbing.pitfalls[0]!.text += " Quote the record id in the file.";
    expect(verify(plumbing).errors.map((f) => f.message)).toEqual(['uses "record id"']);

    // "record", "holdings" and "served" are ordinary words in credit risk; V5 does not ban them
    const ordinary = demo();
    ordinary.pitfalls[0]!.text += " A short track record, the holdings of the pool and the exposures served by it are not plumbing.";
    expect(verify(ordinary).errors).toEqual([]);

    const fine = demo();
    fine.pitfalls[0]!.text += ' For example (e.g. a recession) or i.e. a downturn; the text says "the corpus" in a quotation.';
    expect(verify(fine).errors).toEqual([]);
  });

  test("V6: a summary, a statement and a render over their budgets", () => {
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(" ").replace(/\d/g, "x");
    const s = demo();
    s.summary = words(181);
    expect(verify(s).errors.map((f) => f.where)).toEqual(["summary"]);
    s.summary = words(180);
    expect(verify(s).errors).toEqual([]);

    const st = demo();
    st.requirements[1]!.statement = words(221);
    expect(verify(st).errors.map((f) => f.where)).toEqual(["requirements.R2.statement"]);

    const big = demo();
    big.requirements[0]!.evidence = Array.from({ length: 400 }, (_, i) => `an artifact the reviewer will ask for number ${"x".repeat(i % 7)} in some detail here`);
    expect(verify(big).errors.some((f) => f.rule === "V6" && f.where === "render")).toBe(true);
  });

  test("V7: law with no regulation provision, and practice that lists provisions", () => {
    const law = demo();
    law.basis[1]!.force = "law"; // the EBA guideline paragraph, called law
    expect(verify(law).errors.map((f) => `${f.rule} ${f.where}`)).toEqual(["V7 basis[1]"]);

    const practice = demo();
    practice.methods[1]!.provisions = ["regulation://eba/gl-2017-16/78"];
    expect(verify(practice).errors.map((f) => `${f.rule} ${f.where}`)).toEqual(["V7 methods[1]"]);
  });

  test("V8: an instrument said to be outside the library is held", () => {
    const byName = demo();
    byName.outside_library.push({ name: "The CRR", why: "x" });
    expect(verify(byName).errors).toHaveLength(1);
    expect(verify(byName).errors[0]).toMatchObject({ rule: "V8", where: "outside_library[1]" });

    const byNumber = demo();
    byNumber.outside_library.push({ name: "Regulation (EU) No 575/2013", why: "x" });
    expect(rules(verify(byNumber))).toEqual(["V8"]);

    // a different act with a different number is not held; a word that merely contains a short name is not a hit
    const fine = demo();
    fine.outside_library.push({ name: "Commission Delegated Regulation (EU) 2022/439", why: "x" }, { name: "The crrfoo guidance", why: "x" });
    expect(verify(fine).errors).toEqual([]);
  });

  test("warnings do not block: no evidence, no checks, an unapproved related playbook, an unsupported citation", () => {
    const pb = demo();
    pb.requirements[0]!.evidence = [];
    pb.requirements[1]!.checks = [];
    pb.basis[0]!.citation = "Art. 179(1)(d) CRR";
    pb.methods[0]!.provisions = [];
    pb.related = ["playbook://other"];
    const c = ctx();
    const other = { ...demo(), id: "playbook://other" as const, provenance: { ...demo().provenance, status: "draft" as const } };
    const withOther = { ...c, playbooks: new Map([...(c.playbooks ?? []), [other.id, { title: other.title, status: other.provenance.status }]]) };
    const v = verify(pb, withOther);
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((f) => f.where)).toEqual(
      expect.arrayContaining(["requirements.R1", "requirements.R2", "basis[0]", "methods[0]", "related"]),
    );
  });

  test("a fully valid playbook may cite every member and exclude none", () => {
    const pb = demo();
    pb.excluded = [];
    pb.requirements[0]!.provisions.push({ id: "regulation://crr/180" }, { id: "regulation://eba/gl-2017-16/s4" });
    expect(verify(pb).errors).toEqual([]);
  });
});

describe("playbookContext", () => {
  test("builds the lookups the renderer and verifier read, and leaves optional ones absent", () => {
    const c = playbookContext({ regulations: [], sources: [] });
    expect(c.checks).toBeUndefined();
    expect(c.playbooks).toBeUndefined();
    // without checks or playbooks in the context, those ids cannot be checked and are not reported
    const v = verifyPlaybook(demo(), { regulations: ctx().regulations, sources: ctx().sources });
    expect(v.errors.filter((f) => f.rule === "V1")).toEqual([]);
  });
});
