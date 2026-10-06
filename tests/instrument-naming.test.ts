import { describe, expect, it } from "bun:test";

import { resolveCitationDetailed } from "../src/file-adapter.ts";
import type { DocumentHolding, Regulation } from "../src/schema.ts";

// ── Naming an instrument: by number, by name, by title ─────────────────────────
//
// A citation names the instrument a provision belongs to in whatever spelling the
// writer knows. Every spelling the resolver does not recognise drops the
// instrument, and the bare provision number then goes looking in every held
// document and is answered with a same-numbered provision of an unrelated one - a
// confident wrong citation, or a list of containing provisions across documents
// with the act's own number read as sub-points. These pin the spellings, each
// against a synthetic corpus in which several documents share the numbers, so a
// leak would be seen. (Act numbers here are public law; the corpus is invented.)
//
// The second half is the other direction: a held document or instrument named by
// its English name, its official number or its registry title must be found in
// that document and nowhere else, and a name that is NOT one of those must never
// be answered out of a same-numbered provision of whichever document has one.

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

// A registry entry for a document, as `holdings` carries it.
const holding = (documentId: string, framework: string, title: string, records: number, partial?: boolean): DocumentHolding => ({
  document_id: documentId,
  framework,
  title,
  records,
  ...(partial === undefined ? {} : { partial }),
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
    expect(note).toContain("1 held provision(s) name it: regulation://gl-a/p77");
  });
});

describe("a numbered act written number first is read as the same act written kind first", () => {
  // "2019/2033 Regulation", "the 2014/65/EU Directive": how an act is named in prose that
  // does not give its formal citation. The number was read as points of the provision,
  // and when it was the CRR's number the kind word that says it is not the CRR was ignored.
  const unheld: Array<[string, string]> = [
    ["Article 5(4) of 2014/65/EU Directive", "Directive 2014/65/EU"],
    ["Article 5 of the 2014/59/EU Directive", "Directive 2014/59/EU"],
    ["Article 12 of 2019/2033 Regulation", "Regulation (EU) 2019/2033"],
    ["Article 12 of the 2019/2033/EU Regulation", "Regulation (EU) 2019/2033"],
    ["Article 12 of 2021/451 Decision", "Decision (EU) 2021/451"],
    ["Article 12 of 1606/2002 (EC) Regulation", "Regulation (EC) No 1606/2002"],
    ["2019/2033 Regulation, Article 12", "Regulation (EU) 2019/2033"],
  ];
  for (const [text, label] of unheld) {
    it(`declines by name: ${text}`, () => {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}.`);
      expect(r.unmatched_segments).toEqual([]);
    });
  }

  it("a held instrument's number with the word of another kind of act is that other act", () => {
    // No directive or decision is numbered 575/2013. Resolving the citation into the
    // CRR would be the confident wrong citation: the caller named something else.
    for (const [text, label] of [
      ["Article 12 of 575/2013 Directive", "Directive 2013/575"],
      ["Article 12 of the 575/2013/EU Directive", "Directive 2013/575/EU"],
      ["Article 12 of No 575/2013 Decision", "Decision 2013/575"],
      ["Article 12, 575/2013 Decision", "Decision 2013/575"],
      ["575/2013 Directive, Article 12", "Directive 2013/575"],
    ] as const) {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}.`);
    }
  });

  it("the same number with the kind it has is the CRR, as written kind first", () => {
    for (const text of [
      "Article 12 of 575/2013 Regulation",
      "Article 12 of the 575/2013/EU Regulation",
      "Article 12 of 575/2013 (EU) Regulation",
      "Article 12 of Regulation (EU) No 575/2013",
    ]) {
      expect(resolveCitationDetailed(corpus(), text).match?.id, text).toBe("regulation://crr/article-12");
    }
  });

  it("a kind word that begins the next act is not this number's kind", () => {
    const next = resolveCitationDetailed(corpus(), "Article 5 of Directive 2014/65/EU Regulation (EU) No 575/2013");
    declined(next);
    expect(next.coverage_note).toContain("holds no Directive 2014/65/EU.");
    expect(next.coverage_note).not.toContain("Regulation (EU) 2014/65");
    const before = resolveCitationDetailed(corpus(), "Article 5 of Regulation (EU) No 575/2013 Directive 2013/36/EU");
    declined(before);
    expect(before.coverage_note).toContain("holds no CRD");
    expect(before.coverage_note).not.toContain("Directive 2013/575");
  });

  it("what is not an act number is not read as one", () => {
    // No year and no institution, a date, a document's own number: none is an act.
    for (const text of ["Article 5 of 5/2 Regulation", "Article 5 of 3/4 Decision", "Article 5 of 26/06/2013 Regulation", "Article 5 of 2017/16 Guidelines"]) {
      expect(resolveCitationDetailed(corpus(), text).coverage_note ?? "", text).not.toContain("holds no");
    }
  });

  it("names the served records that mention the act written number first", () => {
    const regs = [
      ...corpus(),
      reg("regulation://gl-a/p77", "Paragraph 77", "acme-gl-a", "acme", { text: "Institutions apply the 2014/65/EU Directive here." }),
    ];
    const note = resolveCitationDetailed(regs, "Article 5 of Directive 2014/65/EU").coverage_note ?? "";
    expect(note).toContain("1 held provision(s) name it: regulation://gl-a/p77");
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
    expect(note).toContain("1 held provision(s) name it: regulation://gl-a/p77");
  });
});

describe("a held instrument named beside an unheld act is judged by the act", () => {
  it("declines naming the act when the act is where the provision is", () => {
    // The corpus holds the CRR. A citation that also names an act it does not hold is
    // about that act as far as this gate can tell: the held name does not vouch for it,
    // and the bare article number must not go looking in every document.
    for (const [text, label] of [
      ["Article 3(4) of implementing regulation 2021/451 referred to in the Capital Requirements Regulation", "Regulation (EU) 2021/451"],
      ["Article 5 of Directive 2014/65/EU referred to in the CRR", "Directive 2014/65/EU"],
      ["Article 5 of Regulation (EU) 2024/1623 amending the CRR", "Regulation (EU) 2024/1623"],
      ["Article 5 of Directive 2014/65/EU and the CRR", "Directive 2014/65/EU"],
    ] as const) {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note, text).toContain(`holds no ${label}.`);
    }
  });

  it("does not refuse a held instrument's own provision for the act that only amends or implements it", () => {
    // "... of the CRR, as amended by Regulation (EU) 2024/1623" asks about the CRR. The
    // refusal "this corpus holds no Regulation (EU) 2024/1623" would be true and beside
    // the point; the act's number is not read as the provision's, so nothing is matched,
    // but the held article is offered, and only from the held document.
    for (const text of [
      "Article 5 of the CRR, as amended by Regulation (EU) 2024/1623",
      "Article 5 of the Capital Requirements Regulation, as amended by Regulation (EU) 2024/1623",
      "Article 5 of Regulation (EU) No 575/2013 as supplemented by Commission Delegated Regulation (EU) 2022/439",
      "Article 5 CRR, referred to in Directive 2014/65/EU",
      "Article 5 CRR, implemented in accordance with Regulation 2021/451",
    ]) {
      const r = resolveCitationDetailed(corpus(), text);
      expect(r.match, text).toBeNull();
      expect(r.coverage_note ?? "", text).not.toContain("holds no");
      expect(r.candidates.map((c) => c.document_id), text).toEqual(["crr"]);
    }
  });

  it("an act that is the only instrument named is always the gate's, whatever precedes it", () => {
    for (const text of ["Article 5 as amended by Regulation (EU) 2024/1623", "Article 5, referred to in Directive 2014/65/EU"]) {
      declined(resolveCitationDetailed(corpus(), text));
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

describe("a held instrument named in the citation scopes it to the documents that carry it", () => {
  const holdings = [
    holding("crr", "crr", "Regulation (EU) No 575/2013 (CRR)", 3, true),
    holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods", 3),
    holding("acme-gl-b", "acme", "Acme guidelines on beta estimation (consolidated)", 4),
  ];
  const names = [
    "the Capital Requirements Regulation",
    "Regulation (EU) No 575/2013",
    "Regulation (EU) 2013/575",
    "Regulation 575/2013",
    "the CRR (Regulation (EU) No 575/2013)",
    "CRR",
  ];

  for (const name of names) {
    it(`Article 153 of ${name}: nothing is matched, and the absence is the corpus's`, () => {
      // Paragraph 153 of a guideline is the only record numbered 153 anywhere. It is
      // not what was asked for, and it used to be returned as a confident match.
      const r = resolveCitationDetailed(corpus(), `Article 153 of ${name}`, holdings);
      declined(r);
      expect(r.unmatched_segments).toEqual(["153"]);
      expect(r.coverage_note).toContain("Nothing in this library is numbered 153 in the document named");
      expect(r.coverage_note).toContain("This library holds only part of Regulation (EU) No 575/2013 (CRR)");
    });

    it(`Article 12 of ${name}: the CRR's article, though both guidelines have a paragraph 12`, () => {
      const r = resolveCitationDetailed(corpus(), `Article 12 of ${name}`, holdings);
      expect(r.match?.id).toBe("regulation://crr/article-12");
      expect(r.confidence).toBe("segment");
    });
  }

  it("the number of the act never becomes points of the provision", () => {
    // At 2013 and 575 the spine was [160, 575, 2013]; only the first is the provision.
    const r = resolveCitationDetailed(corpus(), "Article 160 of Regulation (EU) No 575/2013");
    expect(r.match?.id).toBe("regulation://crr/article-160");
    const miss = resolveCitationDetailed(corpus(), "Article 161 of Regulation (EU) No 575/2013");
    expect(miss.unmatched_segments).toEqual(["161"]);
  });

  it("a containing article is reported from the instrument named, and from no other document", () => {
    const regs = [...corpus(), reg("regulation://crr/article-181", "Article 181", "crr", "crr", { text: "1. First.\n2. Second:\n(a) one;\n(b) two." })];
    const r = resolveCitationDetailed(regs, "Article 181(2)(b) of Regulation (EU) No 575/2013");
    expect(r.candidates.map((c) => c.id)).toEqual(["regulation://crr/article-181"]);
    expect(r.coverage_note).toContain("whose text carries point 2.b");
  });

  it("a held numbered act with ids that carry its number is found by that number", () => {
    const regs = [
      ...corpus(),
      reg("regulation://regulation-2021-930/article-3", "Article 3", "regulation-2021-930", "acme"),
      reg("regulation://gl-a/p3", "Paragraph 3", "acme-gl-a", "acme"),
      reg("regulation://gl-b/p3", "Paragraph 3", "acme-gl-b", "acme"),
    ];
    for (const text of [
      "Article 3 of Commission Delegated Regulation (EU) 2021/930",
      "Article 3 of Regulation 2021/930",
      "Article 3 of Regulation (EU) No 930/2021",
    ]) {
      const r = resolveCitationDetailed(regs, text);
      expect(r.match?.id, text).toBe("regulation://regulation-2021-930/article-3");
    }
  });

  it("the formula an act is cited with is not a second name", () => {
    for (const text of [
      "Article 12 of Regulation (EU) No 575/2013 of the European Parliament and of the Council",
      "Article 12 of Regulation (EU) No 575/2013 of the European Parliament and of the Council of 26 June 2013",
      "Article 12 of Commission Delegated Regulation (EU) No 575/2013",
      "Article 12, in the first sentence, of Regulation (EU) No 575/2013",
    ]) {
      expect(resolveCitationDetailed(corpus(), text, holdings).match?.id, text).toBe("regulation://crr/article-12");
    }
  });

  it("a deeper point is reported from the instrument's own document, with the numerals of a list left alone", () => {
    const r = resolveCitationDetailed(corpus(), "Article 12(2)(a)(ii) of Regulation (EU) No 575/2013 of the European Parliament and of the Council", holdings);
    expect(r.match).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual(["regulation://crr/article-12"]);
  });
});

describe("a name the registry or the instrument supplies scopes a citation only when it is accounted for", () => {
  const holdings = [
    holding("crr", "crr", "Regulation (EU) No 575/2013 (CRR)", 3, true),
    holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods", 3),
    holding("acme-gl-b", "acme", "Acme guidelines on beta estimation (consolidated)", 4),
  ];

  it("a mention in a clause that only says what an unrecognised guideline is issued under is not the home of the provision", () => {
    // Paragraph 153 exists once in the corpus, in alpha. The caller is citing a guideline
    // the corpus does not hold, "referred to in" the regulation. Scoped to the regulation
    // (which has no 153) this declines; scoped to the framework's other documents it would
    // be paragraph 153 of alpha. Neither may come back as a match.
    for (const text of [
      "Paragraph 153 of Acme guidelines on gamma identification referred to in Regulation (EU) No 575/2013",
      "Paragraph 12 of Acme guidelines on gamma identification referred to in Regulation (EU) No 575/2013",
      "Paragraph 12 of the Capital Requirements Regulation referred to in Acme guidelines on gamma identification",
    ]) {
      const r = resolveCitationDetailed(corpus(), text, holdings);
      expect(r.match, text).toBeNull();
      expect(r.confidence, text).toBe("none");
    }
  });

  it("two documents named by title are never resolved into either", () => {
    const r = resolveCitationDetailed(
      corpus(),
      "Paragraph 12 of Acme guidelines on alpha estimation methods referred to in Acme guidelines on beta estimation",
      holdings,
    );
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("none");
  });

  it("a held document and a named instrument are never resolved into either", () => {
    // The number of the instrument is still in the citation, so the scope is not
    // taken and the number is not read away: the provision is not found in either.
    for (const text of [
      "Paragraph 12 of acme-gl-a (Regulation (EU) No 575/2013)",
      "Paragraph 12 of Acme guidelines on alpha estimation methods (Regulation (EU) No 575/2013)",
      "Article 12 of Regulation (EU) No 575/2013 (Acme guidelines on alpha estimation methods)",
    ]) {
      const r = resolveCitationDetailed(corpus(), text, holdings);
      expect(r.match, text).toBeNull();
      expect(r.confidence, text).toBe("none");
    }
  });

  it("another act, by number, still in the citation stops the scope", () => {
    // The number of the second act would read as points of the provision.
    const r = resolveCitationDetailed(corpus(), "Article 5 of Regulation (EU) No 575/2013 and Regulation (EU) 2022/439", holdings);
    declined(r);
    expect(r.coverage_note).toContain("holds no Regulation (EU) 2022/439");
  });

  it("with the names taken off, a citation that is exactly a record's own is resolved, whatever the name", () => {
    // The scope is accepted on an exact hit: nothing is left over that could name anything.
    const regs = [...corpus(), reg("regulation://crr/section-q9", "Section Q9.ZK-a", "crr", "crr")];
    const r = resolveCitationDetailed(regs, "Regulation (EU) No 575/2013 - Section Q9.ZK-a", holdings);
    expect(r.match?.id).toBe("regulation://crr/section-q9");
    expect(r.confidence).toBe("exact");
  });

  it("the ids alone scope as before, whatever else the citation says", () => {
    // A name the records carry is not derived: it is not withheld by the words around it.
    expect(resolveCitationDetailed(corpus(), "Article 12 of CRR on the treatment of exposures", holdings).match?.id).toBe("regulation://crr/article-12");
    expect(resolveCitationDetailed(corpus(), "Paragraph 4 of acme-gl-b in the consolidated version", holdings).match?.id).toBe("regulation://gl-b/p4");
  });

  it("a number that belongs to another kind of act is not the CRR's", () => {
    // No directive is numbered 575/2013. Reading the bare number out of "Directive (EC)
    // 575/2013" would hand a provision of one body of law to another.
    for (const text of ["Article 12 of Directive (EC) 575/2013", "Annex 12 in Directive (Euratom) 575/2013", "Article 12 of Decision 575/2013"]) {
      const r = resolveCitationDetailed(corpus(), text, holdings);
      declined(r);
      expect(r.coverage_note, text).toMatch(/holds no (Directive|Decision)/);
    }
  });

  it("two held instruments named by number are not a second name for one document", () => {
    // Directive 2013/36/EU names the CRD; the corpus holds the CRR alone. The CRD is
    // the gate's business, and the number of the CRR does not vouch for it.
    const r = resolveCitationDetailed(corpus(), "Article 5 of Directive 2013/36/EU and Regulation (EU) No 575/2013", holdings);
    declined(r);
    expect(r.coverage_note).toContain("holds no CRD");
  });
});

describe("a registry title names its document", () => {
  const holdings = [
    holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods", 3),
    holding("acme-gl-b", "acme", "Acme guidelines on beta estimation (consolidated)", 4),
    holding("crr", "crr", "Acme Code of Practice \u2014 consolidated edition", 3),
  ];

  it("the whole title scopes the citation, though both guidelines have a paragraph 12", () => {
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of Acme guidelines on alpha estimation methods", holdings);
    expect(r.match?.id).toBe("regulation://gl-a/p12");
    expect(r.confidence).toBe("segment");
  });

  it("so does the title without its parenthetical", () => {
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of Acme guidelines on beta estimation", holdings);
    expect(r.match?.id).toBe("regulation://gl-b/p12");
  });

  it("so does a parenthetical that is itself a name, but not one too short to be", () => {
    const named = [
      holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods ('Alpha estimation toolkit') (consolidated, June 2026)", 3),
      holding("acme-gl-b", "acme", "Acme guidelines on beta estimation (BETA)", 4),
    ];
    // Three words: a name. Two (consolidated, June) and one (BETA) are not.
    expect(resolveCitationDetailed(corpus(), "Paragraph 12 of the Alpha estimation toolkit", named).match?.id).toBe("regulation://gl-a/p12");
    expect(resolveCitationDetailed(corpus(), "Paragraph 12 of Alpha estimation toolkit guidelines", named).match?.id).toBe("regulation://gl-a/p12");
    expect(resolveCitationDetailed(corpus(), "Paragraph 12 of the consolidated version", named).match).toBeNull();
  });

  it("so does the part before a dash", () => {
    const r = resolveCitationDetailed(corpus(), "Article 12 of Acme Code of Practice", holdings);
    expect(r.match?.id).toBe("regulation://crr/article-12");
  });

  it("so does the part before the clause that names its legal basis", () => {
    // How a guideline is called: the title minus "under Article N of Regulation ...".
    const legal = [
      holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods under Article 178 of Regulation (EU) No 575/2013", 3),
      holding("acme-gl-b", "acme", "Acme guidelines on beta estimation (consolidated)", 4),
    ];
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of the Acme guidelines on alpha estimation methods", legal);
    expect(r.match?.id).toBe("regulation://gl-a/p12");
    // ...and the number of the regulation inside the title is not an instrument named beside it.
    const whole = resolveCitationDetailed(
      corpus(),
      "Paragraph 12 of Acme guidelines on alpha estimation methods under Article 178 of Regulation (EU) No 575/2013",
      legal,
    );
    expect(whole.match?.id).toBe("regulation://gl-a/p12");
  });

  it("an instrument quoted inside a recognised title is part of the title, not a claim that it is held", () => {
    const legal = [holding("acme-gl-a", "acme", "Acme guidelines on alpha estimation methods under Article 178 of Regulation (EU) No 575/2013", 3)];
    const noCrr = corpus().filter((r) => r.document_id !== "crr");
    const title = "Paragraph 12 of Acme guidelines on alpha estimation methods under Article 178 of Regulation (EU) No 575/2013";
    const r = resolveCitationDetailed(noCrr, title, legal);
    expect(r.coverage_note ?? "").not.toContain("holds no");
    // ...while naming the regulation on its own is still a claim about it.
    const alone = resolveCitationDetailed(noCrr, "Article 12 of Regulation (EU) No 575/2013", legal);
    declined(alone);
    expect(alone.coverage_note).toContain("holds no CRR");
  });

  it("only exact words scope: part of a title does not, and nothing is guessed", () => {
    // "Acme guidelines on alpha" is a prefix of the title. The framework "acme" scopes it to both guidelines, which
    // share the number: ambiguous, never resolved to the one whose title it resembles.
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of Acme guidelines on alpha", holdings);
    expect(r.match).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it("a title too short to be a name scopes nothing", () => {
    const short = [holding("acme-gl-a", "acme", "Guidelines on alpha", 3), holding("acme-gl-b", "acme", "Guidelines on beta", 4)];
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of the Guidelines on alpha", short);
    expect(r.match).toBeNull();
  });

  it("the title scopes the citation only as far as it is accounted for", () => {
    // Words after the title that could name something else withhold the scope: this
    // is the framework's two guidelines again, ambiguous, not alpha.
    const r = resolveCitationDetailed(corpus(), "Paragraph 12 of Acme guidelines on alpha estimation methods for retail exposures", holdings);
    expect(r.match).toBeNull();
  });
});

describe("a citation with a connective left on it is a record's own citation, not a tie", () => {
  // A section whose label reduces to the same number as the article ties with it on the
  // numeric spine. "Article 3 CRR" is exact; "Article 3 of the CRR" has "of the" left
  // after the document's name is taken out, missed the exact pass, and came back
  // ambiguous between the two.
  const regs = (): Regulation[] => [
    reg("regulation://crr/article-3", "Article 3", "crr", "crr"),
    reg("regulation://crr/section-p3", "Section Q9.XY.D2c.T3d-3", "crr", "crr"),
    reg("regulation://crr/article-4", "Article 4", "crr", "crr"),
    reg("regulation://gl-a/p3", "Paragraph 3", "acme-gl-a", "acme"),
  ];

  it("resolves to the article whichever way the document is named", () => {
    for (const text of ["Article 3 CRR", "Article 3 of the CRR", "Article 3 of the Capital Requirements Regulation", "Article 3 of Regulation (EU) No 575/2013"]) {
      const r = resolveCitationDetailed(regs(), text);
      expect(r.match?.id, text).toBe("regulation://crr/article-3");
      expect(r.ambiguous, text).toBe(false);
    }
  });

  it("keeps the labels: exact where nothing was left over, segment where a connective was", () => {
    expect(resolveCitationDetailed(regs(), "Article 3 CRR").confidence).toBe("exact");
    expect(resolveCitationDetailed(regs(), "Article 3 of the CRR").confidence).toBe("segment");
  });

  it("does not drop a point or a kind word with the connectives", () => {
    // (a) is a point and "paragraph" is not "article": neither is grammar.
    const point = resolveCitationDetailed(regs(), "Article 3(a) of the CRR");
    expect(point.match).toBeNull();
    const kind = resolveCitationDetailed(regs(), "Paragraph 3 of the CRR");
    expect(kind.match).toBeNull();
  });

  it("an ambiguity that is real stays one", () => {
    const twins = [...regs(), reg("regulation://crr/annex-3", "Article 3", "crr", "crr")];
    const r = resolveCitationDetailed(twins, "Article 3 of the CRR");
    expect(r.match).toBeNull();
    expect(r.ambiguous).toBe(true);
  });
});

describe("a document named in words nothing here recognises", () => {
  const holdings = [holding("crr", "crr", "Regulation (EU) No 575/2013 (CRR)", 3, true)];

  it("is never answered out of a same-numbered provision of whichever document has one", () => {
    // Paragraph 153 exists once in the whole corpus, in an unrelated guideline. The
    // citation says the provision is in the Basel framework.
    const r = resolveCitationDetailed(corpus(), "Paragraph 153 of the Basel framework", holdings);
    declined(r);
    expect(r.coverage_note).toContain('("basel")');
    expect(r.coverage_note).toContain("a guess");
    expect(r.coverage_note).toContain("crr, acme-gl-a, acme-gl-b");
    // A document held only in part is named, so the absence is read as the corpus's.
    expect(r.coverage_note).toContain("This library holds only part of Regulation (EU) No 575/2013 (CRR)");
  });

  for (const text of [
    "Article 5(4) of Basel III",
    "Paragraph 12 of IFRS 9",
    "Paragraph 12 in the GDPR",
    "Paragraph 5 under the Zeta methodology handbook",
    "Paragraph 12 of the guidelines on beta estimation methods",
    "Article 5 of MiFID II, as amended",
  ]) {
    it(`declines, with no candidates: ${text}`, () => {
      const r = resolveCitationDetailed(corpus(), text);
      declined(r);
      expect(r.coverage_note).toContain("does not recognise as a document it holds");
    });
  }

  it("leaves a citation alone whose tail is only structure, the kind of text and where in it", () => {
    for (const [text, id] of [
      ["Paragraph 153 of the guidelines", "regulation://gl-a/p153"],
      ["Paragraph 153 of the Regulation", "regulation://gl-a/p153"],
      ["Paragraph 153 of this Directive", "regulation://gl-a/p153"],
      ["Paragraph 153 in that paragraph", "regulation://gl-a/p153"],
      ["see Paragraph 153", "regulation://gl-a/p153"],
      ["as required by Paragraph 153", "regulation://gl-a/p153"],
      ["Paragraph 153 in the first sentence", "regulation://gl-a/p153"],
      ["Paragraph 153 of the Regulation as amended", "regulation://gl-a/p153"],
    ] as const) {
      expect(resolveCitationDetailed(corpus(), text).match?.id, text).toBe(id);
    }
  });

  it("leaves a citation alone that names a held document, however it goes on", () => {
    expect(resolveCitationDetailed(corpus(), "Article 12 of CRR on the treatment of exposures").match?.id).toBe("regulation://crr/article-12");
    expect(resolveCitationDetailed(corpus(), "Paragraph 4 of acme-gl-b in the consolidated version").match?.id).toBe("regulation://gl-b/p4");
  });

  it("only reads what follows the last of, in, under or from", () => {
    // "point (a) of Paragraph 153" has "of" and no name after it.
    expect(resolveCitationDetailed(corpus(), "point (a) of Paragraph 153").coverage_note ?? "").not.toContain("does not recognise");
  });

  it("does not stand in front of an exact match", () => {
    const labelled = [...corpus(), reg("regulation://gl-a/p77", "Paragraph 77 of the Basel framework", "acme-gl-a", "acme")];
    expect(resolveCitationDetailed(labelled, "Paragraph 77 of the Basel framework").match?.id).toBe("regulation://gl-a/p77");
  });

  it("does not say it does not recognise a regulation the citation names and the corpus holds", () => {
    // The scope was withheld because of the words after the number, but the regulation
    // is named by its number and is held: "does not recognise" would be untrue of it.
    const r = resolveCitationDetailed(corpus(), "Article 160 of Regulation (EU) No 575/2013 on prudential requirements for credit institutions", holdings);
    expect(r.match).toBeNull();
    expect(r.coverage_note ?? "").not.toContain("does not recognise");
  });
});

describe("a document named twice in one citation", () => {
  // Its id beside its title, its short name beside its number: the longer name
  // scopes the citation and every other name for the SAME document leaves with it,
  // or the second name's year and serial are read as points of the provision (and
  // the citation is declined as naming a document no held one answers to).
  const regs = (): Regulation[] => [
    reg("regulation://gl-2016-07/p3", "Paragraph 3", "eba-gl-2016-07", "eba"),
    reg("regulation://gl-2016-07/p15", "Paragraph 15", "eba-gl-2016-07", "eba"),
    reg("regulation://gl-2017-16/p3", "Paragraph 3", "eba-gl-2017-16", "eba"),
    reg("regulation://crr/article-3", "Article 3", "crr", "crr"),
    reg("regulation://crr/article-180", "Article 180", "crr", "crr"),
  ];
  const holdings = [
    holding("eba-gl-2016-07", "eba", "Guidelines on the application of the definition of default under Article 178 of Regulation (EU) No 575/2013", 2),
    holding("eba-gl-2017-16", "eba", "Guidelines on PD estimation, LGD estimation and the treatment of defaulted exposures", 1),
    holding("crr", "crr", "Regulation (EU) No 575/2013 (CRR)", 2, true),
  ];

  for (const text of [
    "EBA/GL/2016/07 Guidelines on the application of the definition of default Paragraph 15",
    "Paragraph 15 of EBA/GL/2016/07 Guidelines on the application of the definition of default",
    "Paragraph 15 (EBA/GL/2016/07 Guidelines on the application of the definition of default)",
    "Guidelines on the application of the definition of default, EBA GL 2016/07, paragraph 15",
  ]) {
    it(`resolves: ${text}`, () => {
      const r = resolveCitationDetailed(regs(), text, holdings);
      expect(r.match?.id, text).toBe("regulation://gl-2016-07/p15");
    });
  }

  it("a short name beside a number, both for the same instrument", () => {
    for (const text of ["Article 180 CRR (Regulation (EU) No 575/2013)", "CRR, Regulation (EU) No 575/2013, Article 180", "Article 180 of the CRR, that is the Capital Requirements Regulation"]) {
      expect(resolveCitationDetailed(regs(), text, holdings).match?.id, text).toBe("regulation://crr/article-180");
    }
  });

  it("a framework that names several documents is not the same document named again", () => {
    // "EBA" stays in the citation beside a title that names one of its documents.
    const r = resolveCitationDetailed(regs(), "EBA Guidelines on PD estimation, LGD estimation and the treatment of defaulted exposures, paragraph 3", holdings);
    expect(r.match?.id).toBe("regulation://gl-2017-16/p3");
  });
});
