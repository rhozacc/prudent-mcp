import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession, type CallTrace, type Session } from "../evals/harness.ts";
import { descriptiveInstrumentGateHolds, ownCitationsResolve } from "../evals/invariants.ts";
import { resolveCitationDetailed } from "../src/file-adapter.ts";
import type { Regulation } from "../src/schema.ts";

// ── The descriptive instrument gate ───────────────────────────────────────────
//
// A citation can name an instrument by what it IS ("Article 49(3) of the RTS on
// the IRB assessment methodology") instead of by number. The number gate cannot
// read that, so the instrument used to be dropped and the bare article number was
// offered a same-numbered provision of an unrelated held document. Every fixture
// here is synthetic; no test depends on another's state.

const reg = (id: string, citation: string, documentId: string, framework?: string): Regulation => ({
  id: id as Regulation["id"],
  framework: framework ?? id.slice("regulation://".length).split("/")[0]!,
  document_id: documentId,
  document_version: "2024-01-09",
  citation,
  text: "Synthetic provision text.",
  commentary: [],
  children: [],
});

/** Two unrelated held guidelines that both carry a paragraph 49, plus the CRR. */
const base = (): Regulation[] => [
  reg("regulation://gl-a/p49", "Paragraph 49", "acme-gl-a", "acme"),
  reg("regulation://gl-b/p49", "Paragraph 49", "acme-gl-b", "acme"),
  reg("regulation://crr/article-49", "CRR Article 49", "crr"),
  reg("regulation://crr/article-180", "CRR Article 180", "crr"),
  reg("regulation://ecb-guide/section-3", "Chapter 3", "ecb-guide-internal-models", "ecb"),
];

const declined = (r: ReturnType<typeof resolveCitationDetailed>): void => {
  expect(r.match).toBeNull();
  expect(r.candidates).toEqual([]);
  expect(r.confidence).toBe("none");
  expect(r.ambiguous).toBe(false);
};

describe("descriptive instrument gate: declines", () => {
  it("the RTS shape returns null with no candidates though other documents carry paragraph 49", () => {
    const text = "Article 49(3) of the RTS on the IRB assessment methodology";
    const r = resolveCitationDetailed(base(), text);
    declined(r);
    const note = r.coverage_note ?? "";
    expect(note).toContain(text);
    expect(note).toContain("by description");
    expect(note).toContain('"RTS on the IRB assessment methodology"');
    expect(note).toContain("holds no document identified as such");
    expect(note).toContain("rather than sourcing a same-numbered provision from another document");
    expect(note).toContain("by number");
    expect(note).toContain("search_regulation");
    expect(note).toContain("get_corpus_info");
  });

  it("the same citation without the gate would have found paragraph 49 (the fixture binds)", () => {
    // The fixture is only a test if the bare number does resolve candidates.
    const r = resolveCitationDetailed(base(), "Article 49(3)");
    expect(r.candidates.length + (r.match === null ? 0 : 1)).toBeGreaterThan(0);
  });

  const forms = [
    "Article 49 of the RTS on the assessment methodology",
    "Article 49 of the regulatory technical standards on assessment",
    "Article 49 of the Regulatory Technical Standard on assessment",
    "Article 49 of the ITS on supervisory reporting",
    "Article 49 of the implementing technical standards on reporting",
    "Article 49 of the Commission Delegated Regulation on assessment",
    "Article 49 of the delegated act on assessment",
    "Article 49 of the Commission Implementing Regulation on reporting",
    "Article 49 of an implementing decision on reporting",
    "Article 49 of the ECB Regulation on reporting",
    "Article 49 of an ECB Guideline on reporting",
    "Article 49 of the ECB recommendation on reporting",
    "Article 49 of the ECB decision on reporting",
    "Article 49 of the Guideline of the ECB on reporting",
    "Article 49 of the guidelines of the European Central Bank on reporting",
  ];
  for (const text of forms) {
    it(`declines: ${text}`, () => {
      const r = resolveCitationDetailed(base(), text);
      declined(r);
      expect(r.coverage_note).toContain("by description");
    });
  }

  it("names both when the citation names a held document and an unheld described instrument", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of the CRR and the RTS on assessment");
    declined(r);
    const note = r.coverage_note ?? "";
    expect(note).toContain("CRR");
    expect(note).toContain("RTS on assessment");
    expect(note).toContain("Name one instrument");
  });

  it("names both for a held document named by id segment", () => {
    const r = resolveCitationDetailed(base(), "ITS on reporting, paragraph 49 of acme-gl-a");
    declined(r);
    expect(r.coverage_note).toContain("acme-gl-a");
    expect(r.coverage_note).toContain("ITS on reporting");
  });

  it("an RTS is still declined when the only look-alike ids merely contain the letters", () => {
    // "limits" contains "its" and "reports" contains "rts": tokens, not substrings.
    const regs = [
      reg("regulation://limits-guide/p49", "Paragraph 49", "limits-guide", "reports"),
      ...base(),
    ];
    declined(resolveCitationDetailed(regs, "Article 49 of the RTS on assessment"));
    declined(resolveCitationDetailed(regs, "Article 49 of the ITS on assessment"));
  });

  it("a description with no provision number keeps the existing no-number note", () => {
    // Nothing to place means nothing to source from another document.
    const r = resolveCitationDetailed(base(), "the RTS on economic downturn");
    expect(r.match).toBeNull();
    expect(r.coverage_note).toContain("no provision number");
  });

  it("an all-capitals citation does not trust the acronyms", () => {
    // Case is what tells RTS from a shouted pronoun; with it gone, say nothing new.
    const r = resolveCitationDetailed(base(), "PARAGRAPH 49 AND ITS ANNEX");
    expect(r.coverage_note ?? "").not.toContain("by description");
  });
});

describe("descriptive instrument gate: a descriptor followed by a number", () => {
  it("belongs to the number gate when the number is one it reads, with or without (EU)", () => {
    // "Delegated Regulation 2022/439" used to fall to the descriptive gate because
    // the number gate wanted "(EU)"; it reads a bare YEAR/serial now, and the note
    // is the better one - it names the number.
    for (const [text, label] of [
      ["Article 49 of the Delegated Regulation 2022/439", "Regulation (EU) 2022/439"],
      ["Article 49 of Commission Delegated Regulation No 2022/439", "Regulation (EU) 2022/439"],
      ["Article 49 of the Commission Implementing Regulation 2021/451", "Regulation (EU) 2021/451"],
    ] as const) {
      const r = resolveCitationDetailed(base(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}`);
      expect(r.coverage_note, text).not.toContain("by description");
    }
  });

  it("stays a description, with advice about the form, where the number gate does not read the kind", () => {
    for (const text of ["Article 49 of the ITS 2021/451", "Article 49 of the RTS (EU) No 2016/03", "Article 49 of the Delegated Act 12/2020"]) {
      const r = resolveCitationDetailed(base(), text);
      declined(r);
      const note = r.coverage_note ?? "";
      expect(note, text).toContain("by description");
      // The caller did cite a number; the advice is about its form, not "cite it by number".
      expect(note, text).toContain('kind then "(EU)" then its number');
      expect(note, text).not.toContain("Cite the instrument by number");
    }
  });

  it("the same shape with (EU) is still the number gate's", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of the Delegated Regulation (EU) 2022/439");
    declined(r);
    expect(r.coverage_note).toContain("holds no Regulation (EU) 2022/439");
    expect(r.coverage_note).not.toContain("by description");
  });

  it("a delegated ACT with (EU), which the number gate does not read, is a description", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of the Delegated Act (EU) 2022/439");
    declined(r);
    expect(r.coverage_note).toContain("by description");
  });

  it("a descriptor with no number keeps the advice to cite it by number", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of the ITS on reporting");
    expect(r.coverage_note).toContain("Cite the instrument by number");
  });

  it("a kind word beside a pair that is no act number is still read as a description", () => {
    // The pattern matches "Regulation 5/2"; the number gate's reader does not call it
    // an act. The descriptor must not be waved through on the strength of the pattern.
    const r = resolveCitationDetailed(base(), "Article 49 of the Delegated Regulation 5/2");
    declined(r);
    expect(r.coverage_note).toContain("by description");
  });
});

describe("descriptive instrument gate: all-capitals citations", () => {
  it("still recognises RTS, which has no pronoun reading", () => {
    const r = resolveCitationDetailed(base(), "ARTICLE 49(3) OF THE RTS ON THE IRB ASSESSMENT METHODOLOGY");
    declined(r);
    expect(r.coverage_note).toContain("by description");
  });

  it("does not trust ITS, which is also a pronoun", () => {
    const r = resolveCitationDetailed(base(), "PARAGRAPH 49 AND ITS ANNEX");
    expect(r.coverage_note ?? "").not.toContain("by description");
  });
});

describe("descriptive instrument gate: numbered identifiers", () => {
  it("declines an RTS identifier without claiming it names a held document", () => {
    const regs = [...base(), reg("regulation://acme-x/p5", "Paragraph 5", "acme-gl-x", "eba")];
    const r = resolveCitationDetailed(regs, "Article 5 of EBA/RTS/2016/03");
    declined(r);
    const note = r.coverage_note ?? "";
    expect(note).toContain('"EBA/RTS/2016/03"');
    expect(note).toContain("by an identifier");
    expect(note).toContain("holds no document identified as such");
    expect(note).not.toContain("acme-gl-x");
    expect(note).not.toContain("Cite the instrument by number");
  });

  it("is released only by a document carrying that identifier, not by any RTS", () => {
    const other = [...base(), reg("regulation://rts-2020-9/p5", "Paragraph 5", "acme-rts-2020-9", "acme")];
    declined(resolveCitationDetailed(other, "Article 5 of RTS/2016/03"));
    const same = [...base(), reg("regulation://rts-2016-03/p5", "Paragraph 5", "acme-rts-2016-03", "acme")];
    const r = resolveCitationDetailed(same, "Article 5 of RTS/2016/03");
    expect(r.coverage_note ?? "").not.toContain("by an identifier");
  });

  it("a framework alone is described as a group of documents, not as each being named", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of acme ITS");
    declined(r);
    const note = r.coverage_note ?? "";
    expect(note).toContain("documents under a framework or name it shares");
    expect(note).toContain("by description");
  });
});

describe("descriptive instrument gate: every spelling of a kind it names", () => {
  // The gate used to read a kind in one spelling only (RTS in capitals, the long
  // form in single-spaced words), so respelling it was enough to walk round it:
  // the bare article number then went looking in every held document and was
  // answered with a same-numbered provision of an unrelated one - the failure
  // the gate exists to prevent, one keystroke away.
  const respelled = [
    // RTS: case, plural, dots
    "Article 49 of the rts on the assessment methodology",
    "Article 49 of the Rts on the assessment methodology",
    "Article 49 of the RTSs",
    "Article 49 of the rtss on assessment",
    "Article 49(3) of the R.T.S. on the assessment methodology",
    "Article 49(3) of the r.t.s. on the assessment methodology",
    "ARTICLE 49(3) OF THE R.T.S. ON THE ASSESSMENT METHODOLOGY",
    "paragraph 49 of the rts",
    "RTS, Article 49",
    // the long form: hyphens, runs of white space, either case
    "Article 49 of the regulatory-technical-standards on assessment",
    "Article 49 of the Regulatory Technical-Standards on assessment",
    "Article 49 of the regulatory   technical\tstandards on assessment",
    "Article 49 of the REGULATORY TECHNICAL STANDARDS on assessment",
    "Article 49 of the regulatory\u2011technical\u2011standards on assessment",
    // a technical standard named without saying which kind
    "Article 49 of the technical standards on the assessment methodology",
    "Article 49 of the Technical Standard on assessment",
    "Article 49 of the technical-standards on assessment",
    "technical standards, Article 49",
    // ITS
    "Article 49 of the ITSs on reporting",
    "Article 49 of the I.T.S. on reporting",
    "Article 49 of the implementing-technical-standards on reporting",
    "Article 49 of the implementing  technical   standards on reporting",
    // "its" is a pronoun, except where it cannot be one: straight after a determiner
    "Article 49 of the its on reporting",
    "Article 49 of an Its on reporting",
    // the other descriptors, with the same freedoms
    "Article 49 of the Commission Delegated-Regulation on assessment",
    "Article 49 of the commission  delegated   act on assessment",
    "Article 49 of the Commission Implementing-Regulation on reporting",
    "Article 49 of the European Central Bank Guideline on reporting",
    "Article 49 of the European Central Bank's Regulation on x",
    "Article 49 of the E.C.B. Decision on reporting",
  ];
  for (const text of respelled) {
    it(`declines: ${text.replace(/\t/g, "<tab>")}`, () => {
      const r = resolveCitationDetailed(base(), text);
      declined(r);
      expect(r.coverage_note, text).toContain("by description");
    });
  }

  it("never reads the letters of a dotted acronym as points of the provision", () => {
    // "R.T.S." tokenises to r, t, s - single letters, which the spine keeps as points.
    const r = resolveCitationDetailed(base(), "Article 49(3) of the R.T.S. on the assessment methodology");
    expect(r.coverage_note ?? "").not.toMatch(/point 3\.r|could not be established/);
    expect(r.unmatched_segments).toEqual([]);
  });

  it("quotes the descriptor's own words and nothing else", () => {
    const quoted = (text: string): string | undefined =>
      (resolveCitationDetailed(base(), text).coverage_note ?? "").match(/by (?:description|an identifier) \(("[^)]*")\)/)?.[1];
    expect(quoted("see 206(3) of R.T.S..")).toBe('"R.T.S."');
    expect(quoted("Rts - Annex 190")).toBe('"Rts"');
    expect(quoted("the RTSs: Section 16")).toBe('"RTSs"');
    expect(quoted('"Art. 210 Rts"')).toBe('"Rts"');
    expect(quoted("see Article 172(2) of RTSs.")).toBe('"RTSs"');
    expect(quoted("Article 49 of the RTS on the assessment methodology in Article 5")).toBe('"RTS on the assessment methodology"');
    expect(quoted("Article 35 of the technical standards referred to in the Directive")).toBe('"technical standards"');
    expect(quoted("Article 49 of the E.C.B. Decision on reporting. See Article 6")).toBe('"E.C.B. Decision on reporting"');
  });

  it("quotes one description when the same kind is named twice in one phrase", () => {
    const r = resolveCitationDetailed(base(), "Article 49 of the regulatory technical standards (RTS) on assessment");
    declined(r);
    expect((r.coverage_note ?? "").match(/by description \(([^)]*)\)/)?.[1]).toBe('"regulatory technical standards"');
  });

  it("is released by a document of the kind, whichever way the kind is spelled", () => {
    const regs = [...base(), reg("regulation://rts-2021-1/article-49", "Article 49", "acme-rts-2021-1", "acme")];
    for (const text of ["Article 49 of the rts", "Article 49 of the RTSs", "Article 49 of the R.T.S.", "Article 49 of the technical standards"]) {
      expect(resolveCitationDetailed(regs, text).coverage_note ?? "", text).not.toContain("by description");
    }
    // An ITS is not released by an RTS: the bare technical standard is, because it may be either.
    expect(resolveCitationDetailed(regs, "Article 49 of the I.T.S.").coverage_note ?? "").toContain("by description");
  });
});

describe("descriptive instrument gate: does not fire", () => {
  it("on prose that merely contains the pronoun its", () => {
    for (const text of [
      "paragraph 49 of its guidelines",
      "Article 180 CRR and its annexes",
      "its Article 49",
      "Article 49 and its technical annex",
      "Article 49, and of its",
      "paragraph 49 in its entirety",
      "Article 49 of a rule that its text amends",
    ]) {
      const r = resolveCitationDetailed(base(), text);
      expect(r.coverage_note ?? "").not.toContain("by description");
    }
  });

  it("on words that merely contain a kind's letters", () => {
    // Whole words, never substrings: "reports" holds rts, "limits" holds its.
    for (const text of ["Article 49 of the reports", "Article 49 of the limits", "paragraph 49 of the parts", "Article 49 of the Charts", "Article 49 of the Smarts"]) {
      expect(resolveCitationDetailed(base(), text).coverage_note ?? "", text).not.toContain("by description");
    }
  });

  it("when a literal rts sits inside another word and the real descriptor follows it", () => {
    // The residual used to be cut by literal text, so the "rts" inside "reports" went first.
    const r = resolveCitationDetailed(base(), "Article 49 of the reports and the rts on assessment");
    declined(r);
    expect(r.coverage_note).toContain("by description");
    expect(r.coverage_note).not.toContain("a document this corpus holds");
  });

  it("on citations naming only held documents", () => {
    const regs = base();
    expect(resolveCitationDetailed(regs, "CRR Article 180").match?.id).toBe("regulation://crr/article-180");
    expect(resolveCitationDetailed(regs, "Article 49 of the CRR").match?.id).toBe("regulation://crr/article-49");
    expect(resolveCitationDetailed(regs, "paragraph 49 of acme-gl-a").match?.id).toBe("regulation://gl-a/p49");
    // "ECB guide" is a held document, not a described ECB Guideline.
    const guide = resolveCitationDetailed(regs, "Chapter 3 of the ECB guide");
    expect(guide.match?.id).toBe("regulation://ecb-guide/section-3");
  });

  it("when the corpus holds a document identifying as that kind, resolution is normal", () => {
    const regs = [...base(), reg("regulation://rts-2021-1/article-49", "Article 49", "acme-rts-2021-1", "acme")];
    expect(resolveCitationDetailed(regs, "Article 49 of the RTS").coverage_note ?? "").not.toContain("by description");
    // ...and it is the ordinary rules that then place it, once the document is named.
    const named = resolveCitationDetailed(regs, "Article 49 of the RTS, acme-rts-2021-1");
    expect(named.coverage_note ?? "").not.toContain("by description");
    expect(named.match?.id).toBe("regulation://rts-2021-1/article-49");
  });

  it("each kind is released by a document of that kind, and only that kind", () => {
    const held = (kind: string, text: string) => {
      const regs = [...base(), reg(`regulation://${kind}/p49`, "Paragraph 49", `acme-${kind}`, "acme")];
      return resolveCitationDetailed(regs, text).coverage_note ?? "";
    };
    expect(held("its-2022-1", "Article 49 of the ITS on reporting")).not.toContain("by description");
    expect(held("delegated-reg-1", "Article 49 of the delegated regulation on x")).not.toContain("by description");
    expect(held("implementing-reg-1", "Article 49 of the implementing regulation on x")).not.toContain("by description");
    expect(held("ecb-guideline-1", "Article 49 of an ECB Guideline on x")).not.toContain("by description");
    // An RTS document does not release an ITS.
    expect(held("rts-1", "Article 49 of the ITS on reporting")).toContain("by description");
  });

  it("a numbered descriptor belongs to the number gate", () => {
    const heldAct = [...base(), reg("regulation://regulation-2021-930/article-3", "Article 3", "regulation-2021-930", "eu")];
    const r = resolveCitationDetailed(heldAct, "Article 3 of Commission Delegated Regulation (EU) 2021/930");
    // Held: the number gate passes it on, and the descriptor is not read as a second claim.
    expect(r.coverage_note ?? "").not.toContain("by description");
    expect(r.coverage_note ?? "").not.toContain("holds no");

    const unheld = resolveCitationDetailed(base(), "Article 3 of Commission Delegated Regulation (EU) 2021/930");
    declined(unheld);
    expect(unheld.coverage_note).toContain("holds no Regulation (EU) 2021/930");
    expect(unheld.coverage_note).not.toContain("by description");
  });
});

describe("explicit-number gate, extended to guideline numbers", () => {
  it("is unchanged for regulations and directives", () => {
    const r = resolveCitationDetailed(base(), "Article 1 of Regulation (EU) No 9999/9999");
    declined(r);
    expect(r.coverage_note).toContain("holds no Regulation (EU) 9999/9999");
    const d = resolveCitationDetailed(base(), "Article 49 of Directive (EU) 2099/12");
    expect(d.coverage_note).toContain("holds no Directive (EU) 2099/12");
  });

  it("recognises a numbered guideline, and finds served records that name it", () => {
    const regs = [
      ...base(),
      { ...reg("regulation://gl-a/p50", "Paragraph 50", "acme-gl-a", "acme"), text: "See Guideline (EU) 2099/777 for more." },
    ];
    const r = resolveCitationDetailed(regs, "Article 49 of Guideline (EU) 2099/777");
    declined(r);
    expect(r.coverage_note).toContain("holds no Guideline (EU) 2099/777");
    expect(r.coverage_note).toContain("regulation://gl-a/p50");
  });
});

describe("zero match flips", () => {
  // Citations that resolved before the descriptive gate existed, with the answer
  // they gave (confidence included, as recorded from the code before the gate). None may move.
  const regs = [
    ...base(),
    { ...reg("regulation://crr/article-181", "CRR Article 181", "crr"), citation_aliases: ["Art. 181 of the Capital Requirements Regulation"] },
    reg("regulation://gl-a/p12", "Paragraph 12", "acme-gl-a", "acme"),
  ];
  const battery: Array<[string, string, string]> = [
    ["CRR Article 180", "regulation://crr/article-180", "exact"],
    ["Art. 180", "regulation://crr/article-180", "exact"],
    ["Article 180 of the CRR", "regulation://crr/article-180", "segment"],
    ["Article 180 CRR", "regulation://crr/article-180", "exact"],
    ["paragraph 12 of acme-gl-a", "regulation://gl-a/p12", "segment"],
    ["acme gl a paragraph 12", "regulation://gl-a/p12", "exact"],
    ["Chapter 3 of the ECB guide", "regulation://ecb-guide/section-3", "segment"],
    ["Art. 181 of the Capital Requirements Regulation", "regulation://crr/article-181", "alias"],
  ];
  for (const [text, id, confidence] of battery) {
    it(`${text} still resolves to ${id}`, () => {
      const r = resolveCitationDetailed(regs, text);
      expect(r.match?.id).toBe(id as Regulation["id"]);
      expect(r.confidence).toBe(confidence as typeof r.confidence);
    });
  }

  it("every record still resolves from its own citation and from its aliases", () => {
    for (const r of regs) {
      const unique = regs.filter((o) => o.citation === r.citation).length === 1;
      if (!unique) continue;
      expect(resolveCitationDetailed(regs, r.citation).match?.id).toBe(r.id);
      for (const a of r.citation_aliases ?? []) {
        expect(resolveCitationDetailed(regs, a).match?.id).toBe(r.id);
      }
    }
  });
});

describe("a record's own citation resolves before any instrument gate", () => {
  // A corpus is not obliged to keep descriptor words out of its citations: a
  // document may hold "RTS Article 5" or "ECB Guideline paragraph 7" as the
  // labels of its own records. The gates read words in the CALLER's text; when
  // that text is exactly a record's citation, or a label the record declares,
  // the caller quoted the record and nothing may refuse it.
  const zeta = (id: string, citation: string, extra: Partial<Regulation> = {}): Regulation => ({
    ...reg(`regulation://zeta/${id}`, citation, "zeta-gl", "zeta"),
    ...extra,
  });
  const labelled = (): Regulation[] => [
    zeta("rts-5", "RTS Article 5"),
    zeta("its-5", "ITS Article 5"),
    zeta("ecb-7", "ECB Guideline paragraph 7"),
    zeta("del-8", "Delegated Regulation Article 8"),
    zeta("tech-9", "Technical Standards Article 9"),
    zeta("art-6", "Article 6", { citation_aliases: ["RTS Article 6", "the ECB Guidelines, paragraph 6"] }),
    // An act number in a citation, on a document whose ids carry no number.
    zeta("act-14", "Regulation (EU) 2022/439 Article 14(b)"),
    // A same-numbered provision elsewhere, which an unscoped lookup would find.
    reg("regulation://other/p5", "Article 5", "other-gl", "other"),
    reg("regulation://other/p7", "Paragraph 7", "other-gl", "other"),
  ];

  it("a citation equal to a record's own resolves to it, exactly", () => {
    const regs = labelled();
    for (const [text, id] of [
      ["RTS Article 5", "regulation://zeta/rts-5"],
      ["ITS Article 5", "regulation://zeta/its-5"],
      ["ECB Guideline paragraph 7", "regulation://zeta/ecb-7"],
      ["Delegated Regulation Article 8", "regulation://zeta/del-8"],
      ["Technical Standards Article 9", "regulation://zeta/tech-9"],
      ["Regulation (EU) 2022/439 Article 14(b)", "regulation://zeta/act-14"],
    ] as const) {
      const r = resolveCitationDetailed(regs, text);
      expect(r.match?.id, text).toBe(id);
      expect(r.confidence, text).toBe("exact");
    }
  });

  it("a declared alias resolves at its own confidence level", () => {
    const regs = labelled();
    for (const text of ["RTS Article 6", "the ECB Guidelines, paragraph 6"]) {
      const r = resolveCitationDetailed(regs, text);
      expect(r.match?.id, text).toBe("regulation://zeta/art-6");
      expect(r.confidence, text).toBe("alias");
    }
  });

  it("the same words in a different citation are still gated", () => {
    // Not equal to any record's citation: the gate reads them as the caller's own
    // description of an instrument, exactly as before.
    const regs = labelled();
    declined(resolveCitationDetailed(regs, "Article 5 of the RTS on assessment"));
    declined(resolveCitationDetailed(regs, "Paragraph 7 of an ECB Guideline on reporting"));
    declined(resolveCitationDetailed(regs, "Article 14(b) of Regulation (EU) 2099/777"));
  });

  it("every record of a corpus whose citations carry descriptor words resolves from its own citation and aliases", () => {
    const regs = labelled();
    for (const r of regs) {
      if (regs.filter((o) => o.citation === r.citation).length !== 1) continue; // ambiguous by construction
      const got = resolveCitationDetailed(regs, r.citation);
      expect(got.match?.id, r.citation).toBe(r.id);
      for (const a of r.citation_aliases ?? []) expect(resolveCitationDetailed(regs, a).match?.id, a).toBe(r.id);
    }
  });
});

// ── Eval I3/descriptive-instrument ────────────────────────────────────────────

const dir = mkdtempSync(join(tmpdir(), "prudent-i3-desc-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const source = (framework: string, documentId: string) => ({
  id: `source://${framework}/${documentId}`,
  title: `Synthetic ${documentId}`,
  framework,
  document_id: documentId,
  doc_type: "regulation",
  status: "current",
  published: "2010-01-01",
  verified: new Date().toISOString().slice(0, 10),
});

async function runDescriptive(name: string, docs: Array<[string, string]>) {
  const file = join(dir, name);
  const regulation = docs.map(([framework, documentId], n) => ({
    ...reg(`regulation://${documentId}/p49`, "Paragraph 49", documentId, framework),
    text: `Synthetic provision ${n}.`,
  }));
  writeFileSync(file, JSON.stringify({ regulation, sources: docs.map(([f, d]) => source(f, d)) }));
  const session = await openSession({ corpusFile: file });
  try {
    return await descriptiveInstrumentGateHolds(session);
  } finally {
    await session.close();
  }
}

describe("eval I3/descriptive-instrument", () => {
  it("binds on a corpus holding no such documents and finds nothing fatal", async () => {
    const r = await runDescriptive("none.json", [["acme", "acme-gl-a"], ["acme", "acme-gl-b"]]);
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("probes the respelled kinds too, and fails a gate that reads only the canonical spellings", async () => {
    // A stand-in for the gate as it was: the four canonical phrasings are declined,
    // anything respelled is answered out of a same-numbered provision.
    const asked: string[] = [];
    const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
      tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
    });
    const canonical = [
      "Article 1 of the RTS on the assessment methodology",
      "Article 1 of the ITS on supervisory reporting",
      "Article 1 of the Commission Delegated Regulation on a subject",
      "Article 1 of an ECB Guideline on a subject",
    ];
    const old: Session = {
      tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
      async close() {},
      async call(tool, args = {}) {
        if (tool === "get_corpus_info") return trace(tool, args, { coverage: [], holdings: [] });
        const text = String(args["text"] ?? "");
        asked.push(text);
        return canonical.includes(text)
          ? trace(tool, args, { match: null, candidates: [], coverage_note: `"${text}" names an instrument by description` })
          : trace(tool, args, { match: null, candidates: [{ id: "regulation://other/p1" }] });
      },
    };
    const r = await descriptiveInstrumentGateHolds(old);
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.length).toBe(asked.length - canonical.length);
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("rts on the assessment methodology");
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("R.T.S.");
    expect(fatal.map((f) => f.evidence.join(" ")).join(" ")).toContain("technical standards");
  });

  it("is not applicable when the corpus holds a document of every described kind", async () => {
    const r = await runDescriptive("all.json", [
      ["acme", "acme-rts-1"],
      ["acme", "acme-its-1"],
      ["acme", "acme-delegated-1"],
      ["ecb", "ecb-guideline-1"],
    ]);
    expect(r.applicable).toBe(false);
    expect(r.findings.some((f) => f.severity === "fatal")).toBe(false);
  });

  it("still binds on the kinds a corpus lacks when it holds only an RTS", async () => {
    const r = await runDescriptive("rts.json", [["acme", "acme-rts-1"], ["acme", "acme-gl-b"]]);
    expect(r.applicable).toBe(true);
    expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
  });

  it("is not applicable when the kind is carried by framework plus document id, or by the id segment alone", async () => {
    // framework "ecb" + document_id "guideline-2017-697": neither field alone holds "ecb guideline".
    const joined = await runDescriptive("joined.json", [["ecb", "guideline-2017-697"]]);
    const r = resolveCitationDetailed(
      [reg("regulation://guideline-2017-697/article-1", "Article 1", "guideline-2017-697", "ecb")],
      "Article 1 of an ECB Guideline on a subject",
    );
    expect(r.coverage_note ?? "").not.toContain("by description");
    expect(joined.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    // That probe is released; the other three kinds still bind.
    expect(joined.applicable).toBe(true);

    // The kind lives only in the id segment (document_id and framework are opaque).
    const file = join(dir, "segment.json");
    writeFileSync(
      file,
      JSON.stringify({
        regulation: [reg("regulation://delegated-1/p1", "Paragraph 1", "opaque-1", "acme")],
        sources: [source("acme", "opaque-1")],
      }),
    );
    const session = await openSession({ corpusFile: file });
    try {
      const seg = await descriptiveInstrumentGateHolds(session);
      expect(seg.findings.filter((f) => f.severity === "fatal")).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

// ── Eval I3/own-citation ──────────────────────────────────────────────────────

describe("eval I3/own-citation", () => {
  // Texts carry the words the eval searches for, so the records are served in rows.
  const labelled = (id: string, citation: string): Regulation => ({
    ...reg(`regulation://zeta/${id}`, citation, "zeta-gl", "zeta"),
    text: `Synthetic default risk estimation model text for ${id}.`,
  });
  const records = [
    labelled("rts-5", "RTS Article 5"),
    labelled("ecb-7", "ECB Guideline paragraph 7"),
    labelled("act-14", "Regulation (EU) 2022/439 Article 14(b)"),
    labelled("plain", "Article 11"),
  ];

  it("binds on a corpus whose citations carry descriptor words and finds the server resolves them", async () => {
    const file = join(dir, "own-citation.json");
    writeFileSync(file, JSON.stringify({ regulation: records, sources: [source("zeta", "zeta-gl")] }));
    const session = await openSession({ corpusFile: file });
    try {
      const r = await ownCitationsResolve(session);
      expect(r.applicable).toBe(true);
      expect(r.findings.filter((f) => f.severity === "fatal")).toEqual([]);
      // The probes really were the descriptor-bearing citations, not only the plain one.
      const asked = session.traces.filter((t) => t.tool === "resolve_citation").map((t) => String(t.args["text"]));
      expect(asked).toContain("RTS Article 5");
      expect(asked).toContain("ECB Guideline paragraph 7");
    } finally {
      await session.close();
    }
  });

  // A server that refuses any citation containing a descriptor word, as the gate did.
  function refusing(): Session {
    const trace = (tool: string, args: Record<string, unknown>, json: unknown): CallTrace => ({
      tool, args, text: JSON.stringify(json), chars: 0, tokens: 0, ms: 0, isError: false, json,
    });
    return {
      tools: [], surfaceTokens: 0, wireTokens: 0, instructions: "", traces: [],
      async close() {},
      async call(tool, args = {}) {
        if (tool === "search_regulation") {
          return trace(tool, args, { results: records.map((r) => ({ id: r.id, citation: r.citation })) });
        }
        const text = String(args["text"] ?? "");
        const refused = /\b(RTS|ECB Guideline)\b/.test(text);
        const hit = records.find((r) => r.citation === text);
        return trace(tool, args, {
          match: refused || hit === undefined ? null : { id: hit.id },
          confidence: refused ? "none" : "exact",
          candidates: [],
          ambiguous: false,
        });
      },
    };
  }

  it("fails a server that declines a citation it serves for a record", async () => {
    const r = await ownCitationsResolve(refusing());
    const fatal = r.findings.filter((f) => f.severity === "fatal");
    expect(fatal.map((f) => f.id)).toEqual(["I3/own-citation", "I3/own-citation"]);
    expect(fatal[0]?.evidence.join(" ")).toContain("RTS Article 5");
  });

  it("is not applicable when no citation is served", async () => {
    const file = join(dir, "own-citation-empty.json");
    writeFileSync(file, JSON.stringify({}));
    const session = await openSession({ corpusFile: file });
    try {
      const r = await ownCitationsResolve(session);
      expect(r.applicable).toBe(false);
    } finally {
      await session.close();
    }
  });
});
