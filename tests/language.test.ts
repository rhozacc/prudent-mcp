import { describe, expect, it } from "bun:test";

import { applicabilityPageNotice } from "../src/tools/notes.ts";
import { applicabilityText } from "../src/applicability.ts";
import { BANNED_TERMS, bannedTermsIn, identifiersIn, quoted } from "../src/language.ts";

// src/language.ts is the one definition of what the server's own prose may not
// say. I17 (evals) applies it to everything the server writes; these pin the
// definition itself.

describe("bannedTermsIn", () => {
  it("finds the plumbing words, whole and in any case", () => {
    expect(bannedTermsIn("This corpus holds no Record of it.")).toEqual(["corpus", "Record"]);
    expect(bannedTermsIn("Not ingested here, so the text served is the version before it.")).toEqual(["ingested", "served"]);
    expect(bannedTermsIn("The registry says holdings are partial; the adapter agrees.")).toEqual(["registry", "holdings", "adapter"]);
    expect(bannedTermsIn("Records and records.")).toEqual(["Records", "records"]);
  });

  it("finds the multi-word term across any run of white space", () => {
    expect(bannedTermsIn("this   server only describes")).toEqual(["this   server"]);
    expect(bannedTermsIn("this\nserver")).toEqual(["this\nserver"]);
  });

  it("is about words, not letters: nothing inside another word", () => {
    expect(bannedTermsIn("The recording of a corpuscle, an unrecorded observer, a preserved deserved reserve")).toEqual([]);
  });

  it("skips identifiers: tool names, dotted paths and anything in backticks are names, not prose", () => {
    expect(bannedTermsIn("Call get_corpus_info, then search_regulation.")).toEqual([]);
    expect(bannedTermsIn("Read get_corpus_info.holdings for each document.")).toEqual([]);
    expect(bannedTermsIn("`holdings` says whole, part or undeclared; `records` counts them.")).toEqual([]);
    expect(bannedTermsIn("The state `in_force_not_ingested` means the text is behind.")).toEqual([]);
  });

  it("still finds the word beside an identifier", () => {
    expect(bannedTermsIn("Call get_corpus_info for what the corpus holds.")).toEqual(["corpus"]);
  });

  it("says nothing about plain domain prose", () => {
    expect(
      bannedTermsIn(
        "This library holds only part of the CRR (3 provisions), so a provision not found here is not among the parts held, and may still be in the law.",
      ),
    ).toEqual([]);
  });

  it("every banned term is lower case, so the list reads as one", () => {
    for (const t of BANNED_TERMS) expect(t).toBe(t.toLowerCase());
  });
});

describe("identifiersIn", () => {
  it("finds what an answer-bearing string must not contain", () => {
    expect(identifiersIn("See get_source for more.")).toEqual(["get_source"]);
    expect(identifiersIn("Pass `as_of` to ask for a date.")).toEqual(["`as_of`"]);
    expect(identifiersIn("Shown under document_version (2024-01-01).")).toEqual(["document_version"]);
    expect(identifiersIn("Read get_corpus_info.holdings.")).toEqual(["get_corpus_info.holdings"]);
  });

  it("leaves ordinary words, ids with slashes, dates and citations alone", () => {
    expect(identifiersIn("Article 178(1)(a) of the CRR applies from 2026-10-19.")).toEqual([]);
    expect(identifiersIn("Open regulation://crr/article-181 for the text.")).toEqual([]);
    expect(identifiersIn("Pass offset 20 for the next page.")).toEqual([]);
  });
});

describe("quoted: a label from the library's data inside a note", () => {
  const label = "Exclusion of own debt instrument holdings from default-risk requirement";

  it("wraps the label in the library's quotation marks, and the rule does not read inside them", () => {
    expect(quoted(label)).toBe(`“${label}”`);
    expect(bannedTermsIn(label)).toEqual(["holdings"]);
    expect(bannedTermsIn(`Some results are not yet in application: ${quoted(label)} (applies from 2027-01-01).`)).toEqual([]);
    expect(identifiersIn(`${quoted("a_snake_name.field")} applies.`)).toEqual([]);
  });

  it("cannot be ended early by a quotation mark inside the label", () => {
    const q = quoted('Say "the corpus" or “the registry” here');
    expect(q.startsWith("“") && q.endsWith("”")).toBe(true);
    expect(q.slice(1, -1)).not.toMatch(/["“”]/);
    expect(bannedTermsIn(`See ${q} now.`)).toEqual([]);
  });

  it("still reads everything the server itself writes around the label", () => {
    expect(bannedTermsIn(`The holdings of ${quoted(label)} are served.`)).toEqual(["holdings", "served"]);
    expect(bannedTermsIn(`${quoted(label)} is not in the corpus.`)).toEqual(["corpus"]);
  });

  it("a search page's applicability note quotes each row's label and passes the rule", () => {
    const rows = [
      { id: "check://a/one", name: label, applicability: { status: "upcoming" as const, from: "2999-01-01", reason: "Not yet." } },
      { id: "check://a/two", name: "Plain name", applicability: { status: "historical" as const, until: "2001-01-01", reason: "Gone." } },
    ];
    const notes = applicabilityPageNotice(rows, (r) => r.name, new Date("2026-05-01T00:00:00Z"))(rows);
    expect(notes.map((n) => n.type).sort()).toEqual(["historical", "upcoming"]);
    for (const n of notes) {
      expect(n.text).toContain(`“${n.applies_to![0]}”`);
      expect(bannedTermsIn(n.text)).toEqual([]);
      expect(identifiersIn(n.text)).toEqual([]);
    }
    expect(notes.find((n) => n.type === "upcoming")!.text).toContain(`“${label}” (applies from 2999-01-01)`);
  });

  it("an applicability sentence about a labelled entry quotes it, and a server word beside it still fails", () => {
    const a = { status: "upcoming" as const, from: "2999-01-01", reason: "Not yet." };
    const text = applicabilityText(a, "check", { today: "2026-05-01", label });
    expect(text).toContain(`The check “${label}” is not yet in application`);
    expect(bannedTermsIn(text)).toEqual([]);
    expect(bannedTermsIn(`${text} Nothing is held in the corpus.`)).toEqual(["corpus"]);
  });
});
