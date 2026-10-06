import { describe, expect, it } from "bun:test";

import { BANNED_TERMS, bannedTermsIn, identifiersIn } from "../src/language.ts";

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
