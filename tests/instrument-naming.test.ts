import { describe, expect, it } from "bun:test";

import { resolveCitationDetailed } from "../src/file-adapter.ts";
import type { Regulation } from "../src/schema.ts";

// ── Naming an instrument: by number, in every standard spelling ───────────────
//
// A citation names the instrument a provision belongs to in whatever spelling the
// writer knows. Every spelling the resolver does not recognise drops the
// instrument, and the bare provision number then goes looking in every held
// document and is answered with a same-numbered provision of an unrelated one - a
// confident wrong citation, or a list of containing provisions across documents
// with the act's own number read as sub-points. These pin the spellings, each
// against a synthetic corpus in which several documents share the numbers, so a
// leak would be seen. (Act numbers here are public law; the corpus is invented.)

const reg = (id: string, citation: string, documentId: string, framework: string, extra: Partial<Regulation> = {}): Regulation => ({
  id: id as Regulation["id"],
  framework,
  document_id: documentId,
  document_version: "2024-01-09",
  citation,
  text: "Synthetic provision text.",
  commentary: [],
  children: [],
  ...extra,
});

/** Articles of a regulation held in part, and two guidelines that number PARAGRAPHS the same way. */
const corpus = (): Regulation[] => [
  reg("regulation://crr/article-5", "Article 5", "crr", "crr"),
  reg("regulation://crr/article-12", "Article 12", "crr", "crr"),
  reg("regulation://crr/article-160", "Article 160", "crr", "crr"),
  reg("regulation://gl-a/p5", "Paragraph 5", "acme-gl-a", "acme"),
  reg("regulation://gl-a/p12", "Paragraph 12", "acme-gl-a", "acme"),
  reg("regulation://gl-a/p153", "Paragraph 153", "acme-gl-a", "acme"),
  reg("regulation://gl-b/p5", "Paragraph 5", "acme-gl-b", "acme"),
  reg("regulation://gl-b/p12", "Paragraph 12", "acme-gl-b", "acme"),
  reg("regulation://gl-b/p4", "Paragraph 4", "acme-gl-b", "acme"),
  reg("regulation://gl-b/p49", "Paragraph 49", "acme-gl-b", "acme"),
];

const declined = (r: ReturnType<typeof resolveCitationDetailed>): void => {
  expect(r.match).toBeNull();
  expect(r.candidates).toEqual([]);
  expect(r.confidence).toBe("none");
  expect(r.ambiguous).toBe(false);
};

describe("a numbered act in every standard spelling is an instrument the corpus does not hold", () => {
  // [citation, how the refusal names the instrument]
  const unheld: Array<[string, string]> = [
    ["Article 5(4) of Directive 2014/65/EU", "Directive 2014/65/EU"],
    ["Article 5(4) of Directive 2014/59/EU", "Directive 2014/59/EU"],
    ["Article 5 of Directive 2009/138/EC", "Directive 2009/138/EC"],
    ["Article 5 of Council Directive 93/22/EEC", "Directive 93/22/EEC"],
    ["Article 5 of Directive (EU) 2015/2366", "Directive (EU) 2015/2366"],
    ["Art. 12 Commission Regulation EU 2019/2033", "Regulation (EU) 2019/2033"],
    ["Article 12 of Regulation 2019/2033", "Regulation (EU) 2019/2033"],
    ["Article 12 of Regulation (EU) No 2019/2033", "Regulation (EU) 2019/2033"],
    ["Article 12 of Decision 2021/451", "Decision (EU) 2021/451"],
    ["Article 12 of Commission Implementing Decision (EU) 2021/451", "Decision (EU) 2021/451"],
    // The institution is quoted back as the caller wrote it, never relabelled.
    ["Article 12 of Regulation (EC) No 1606/2002", "Regulation (EC) No 1606/2002"],
    ["Article 12 of Regulation EC 1606/2002", "Regulation (EC) No 1606/2002"],
    ["Article 12 of Regulation (EEC) No 2913/1992", "Regulation (EEC) No 2913/1992"],
    // A serial that merely looks like a year (the Communities began in 1958), and a
    // number in which both halves could be one: the era says which is which.
    ["Article 12 of Regulation (EC) No 1907/2006", "Regulation (EC) No 1907/2006"],
    ["Article 12 of Regulation (EC) No 2006/2004", "Regulation (EC) No 2006/2004"],
    ["Article 12 of Regulation (EU) 2019/2033", "Regulation (EU) 2019/2033"],
  ];
  for (const [text, label] of unheld) {
    it(`declines by name: ${text}`, () => {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}.`);
      expect(r.coverage_note, text).toContain("rather than sourcing a same-numbered provision from another document");
    });
  }

  it("never reads the number of the act as points of the provision", () => {
    const r = resolveCitationDetailed(corpus(), "Article 5(4) of Directive 2014/65/EU");
    expect(r.unmatched_segments).toEqual([]);
    expect(r.coverage_note).not.toMatch(/point 2014|containing it/);
  });

  it("states the era's form of a directive, not a regulation's serial/YEAR", () => {
    // "Directive (EU) No 65/2014" would be a wrong citation of a real act.
    const note = resolveCitationDetailed(corpus(), "Article 5 of Directive 2014/65/EU").coverage_note ?? "";
    expect(note).toContain("holds no Directive 2014/65/EU.");
    expect(note).not.toContain("No 65/2014");
    expect(note).not.toContain("(EU) No");
  });

  it("names the served records that mention the act, whichever spelling they use", () => {
    const regs = [
      ...corpus(),
      reg("regulation://gl-a/p77", "Paragraph 77", "acme-gl-a", "acme", { text: "Institutions apply Directive 2014/65/EU here." }),
    ];
    const note = resolveCitationDetailed(regs, "Article 5 of Directive (EU) 2014/65").coverage_note ?? "";
    expect(note).toContain("1 served record(s) name it: regulation://gl-a/p77");
  });
});

describe("what is not an act number stays what it was", () => {
  const guidelines = (): Regulation[] => [
    ...corpus(),
    reg("regulation://gl-2017-16/p78", "Paragraph 78", "eba-gl-2017-16", "eba"),
    reg("regulation://gl-2019-03/p78", "Paragraph 78", "eba-gl-2019-03", "eba"),
  ];

  it("a guideline named by its number is a document, not an act", () => {
    // "Guidelines 2017/16" is how a caller names EBA/GL/2017/16. Reading it as an
    // act number would have the gate declare a held document unheld.
    for (const text of ["EBA Guidelines 2017/16 paragraph 78", "Guidelines 2017/16, paragraph 78", "paragraph 78 of GL 2017/16"]) {
      const r = resolveCitationDetailed(guidelines(), text);
      expect(r.match?.id, text).toBe("regulation://gl-2017-16/p78");
    }
  });

  it("a small pair without a tag is not an act number", () => {
    for (const text of ["Article 5 of Regulation 5/2", "Article 5 of Decision 3/4"]) {
      expect(resolveCitationDetailed(corpus(), text).coverage_note ?? "", text).not.toContain("holds no");
    }
  });

  it("a ECB-style guideline number with its tag is an act", () => {
    const r = resolveCitationDetailed(corpus(), "Article 5 of Guideline (EU) 2017/697");
    declined(r);
    expect(r.coverage_note).toContain("holds no Guideline (EU) 2017/697");
  });
});

describe("the CRR and the CRD are one instrument however they are named", () => {
  const withoutCrr = (): Regulation[] => corpus().filter((r) => r.document_id !== "crr");

  it("the English name, the official number in either order and the short name decline together", () => {
    for (const text of [
      "Article 160 of the Capital Requirements Regulation",
      "Article 160 of Regulation (EU) No 575/2013",
      "Article 160 of Regulation (EU) 2013/575",
      "Article 160 of Regulation 575/2013",
      "Article 160 CRR",
    ]) {
      const r = resolveCitationDetailed(withoutCrr(), text);
      declined(r);
      expect(r.coverage_note, text).toContain("holds no CRR");
    }
  });

  it("the same for the directive", () => {
    for (const text of [
      "Article 5 of the Capital Requirements Directive",
      "Article 5 of Directive 2013/36/EU",
      "Article 5 of Directive (EU) 2013/36",
      "Article 5 of CRD IV",
    ]) {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain("holds no CRD");
    }
  });

  it("a corpus that holds it is never told it does not, in any spelling of its number", () => {
    for (const text of ["Article 160 of Regulation (EU) No 575/2013", "Article 160 of Regulation (EU) 2013/575", "Article 160 of the Capital Requirements Regulation"]) {
      expect(resolveCitationDetailed(corpus(), text).coverage_note ?? "", text).not.toContain("holds no");
    }
  });

  it("finds the instrument whichever way a corpus ids it", () => {
    // Held under an id that carries the number, in the order the number is written in.
    for (const documentId of ["regulation-575-2013", "regulation-2013-575", "reg-crr-2013"]) {
      const regs = [reg("regulation://x/article-160", "Article 160", documentId, "eu"), ...withoutCrr()];
      expect(resolveCitationDetailed(regs, "Article 160 of Regulation (EU) No 575/2013").coverage_note ?? "", documentId).not.toContain("holds no");
    }
  });

  it("names, for the CRR, the served records that quote its number in either order", () => {
    // The mention index is keyed the way the gate keys the instrument: a record that
    // says "Regulation (EU) No 575/2013" is found under the CRR, not under a
    // spelling-specific key nobody asks for.
    const regs = [
      ...withoutCrr(),
      reg("regulation://gl-a/p77", "Paragraph 77", "acme-gl-a", "acme", { text: "See Regulation (EU) No 575/2013." }),
    ];
    const note = resolveCitationDetailed(regs, "Article 160 CRR").coverage_note ?? "";
    expect(note).toContain("1 served record(s) name it: regulation://gl-a/p77");
  });
});

describe("a held instrument named beside an unheld act is judged by the act", () => {
  it("declines naming the act, whichever of the two comes first", () => {
    // The corpus holds the CRR. A citation that also names an act it does not hold is
    // about that act as far as this gate can tell: the held name does not vouch for it,
    // and the bare article number must not go looking in every document.
    for (const [text, label] of [
      ["Article 3(4) of implementing regulation 2021/451 referred to in the Capital Requirements Regulation", "Regulation (EU) 2021/451"],
      ["Article 5 of Directive 2014/65/EU referred to in the CRR", "Directive 2014/65/EU"],
      ["Article 5 of the CRR, as amended by Regulation (EU) 2024/1623", "Regulation (EU) 2024/1623"],
      ["Article 5 of Regulation (EU) 2024/1623 amending the CRR", "Regulation (EU) 2024/1623"],
    ] as const) {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}.`);
    }
  });

  it("two held instruments are not a reason to decline", () => {
    for (const text of ["Article 5 of the CRR (Regulation (EU) No 575/2013)", "Article 5 of Regulation (EU) No 575/2013, the Capital Requirements Regulation"]) {
      expect(resolveCitationDetailed(corpus(), text).coverage_note ?? "", text).not.toContain("holds no");
    }
  });
});

describe("a document number that no held document answers to", () => {
  const guidelines = (): Regulation[] => [
    reg("regulation://gl-2016-07/p49", "Paragraph 49", "eba-gl-2016-07", "eba"),
    reg("regulation://gl-2017-16/p49", "Paragraph 49", "eba-gl-2017-16", "eba"),
    reg("regulation://gl-2017-16/p78", "Paragraph 78", "eba-gl-2017-16", "eba"),
    reg("regulation://crr/article-49", "Article 49", "crr", "crr"),
  ];

  it("is not read as points of the provision, nor answered out of the framework's documents", () => {
    // "EBA" scopes the citation to the EBA documents; 2018 and 04 then fell through as
    // points of paragraph 49, which both held guidelines have.
    const r = resolveCitationDetailed(guidelines(), "Article 49(3) of EBA/GL/2018/04");
    declined(r);
    expect(r.unmatched_segments).toEqual([]);
    expect(r.coverage_note).toContain("names a document by the number EBA/GL/2018/04");
    expect(r.coverage_note).toContain("holds no document that answers to it");
    expect(r.coverage_note).not.toMatch(/point 3\.2018|containing it/);
  });

  for (const text of [
    "Paragraph 49 of EBA GL 2018/04",
    "Paragraph 49 of eba/gl/2018/04",
    "see EBA/GL/2018/04, paragraph 49",
    "EBA/GL/2018/04 paragraph 49",
  ]) {
    it(`declines on the number: ${text}`, () => {
      const r = resolveCitationDetailed(guidelines(), text);
      declined(r);
      expect(r.coverage_note).toContain("names a document by the number");
    });
  }

  for (const text of ["Paragraph 49 of ESMA/2016/1444", "ESMA/2016/1444 paragraph 49", "Paragraph 49 of ECB/2017/20", "Paragraph 49 of JC 2017/37"]) {
    it(`declines when not even the authority is held: ${text}`, () => {
      // Nothing scopes the citation, so the number is the whole identifier and is declined on its own.
      const r = resolveCitationDetailed(guidelines(), text);
      declined(r);
      expect(r.coverage_note, text).toContain("names a document by the number");
    });
  }

  it("an identifier of an instrument named by kind is the descriptive gate's", () => {
    const r = resolveCitationDetailed(guidelines(), "Paragraph 49 of EBA/RTS/2018/04");
    declined(r);
    expect(r.coverage_note).toContain("names an instrument by an identifier");
  });

  it("a held document's number is consumed by its name and resolves as it always did", () => {
    for (const text of [
      "Paragraph 78 of EBA/GL/2017/16",
      "EBA GL 2017/16 paragraph 78",
      "paragraph 78 of GL 2017-16",
      "EBA/GL/2017/16, paragraph 78",
    ]) {
      expect(resolveCitationDetailed(guidelines(), text).match?.id, text).toBe("regulation://gl-2017-16/p78");
    }
  });

  it("a date or a year is not an identifier", () => {
    // 06/2026 has no authority in front of it, and "Article" is structure, not an authority.
    // A third number after the serial makes it an ISO date, which is not one either.
    for (const text of [
      "Paragraph 49 of eba-gl-2017-16, version 06/2026",
      "Article 2018/04",
      "Section 5 of the guidance published 12/2019",
      "Paragraph 49 of eba-gl-2017-16 as published 2019-12-31",
    ]) {
      expect(resolveCitationDetailed(guidelines(), text).coverage_note ?? "", text).not.toContain("names a document by the number");
    }
  });

  it("the number alone, with no provision, is the same decline", () => {
    const r = resolveCitationDetailed(guidelines(), "EBA/GL/2018/04");
    declined(r);
    expect(r.coverage_note).toContain("names a document by the number EBA/GL/2018/04");
  });
});
