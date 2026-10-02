import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSession } from "../evals/harness.ts";
import { descriptiveInstrumentGateHolds } from "../evals/invariants.ts";
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

describe("descriptive instrument gate: numbered descriptors the number gate cannot read", () => {
  it("a descriptor followed by a number without (EU) is declined, not given candidates", () => {
    for (const text of [
      "Article 49 of the Delegated Regulation 2022/439",
      "Article 49 of Commission Delegated Regulation No 2022/439",
      "Article 49 of the Commission Implementing Regulation 2021/451",
    ]) {
      const r = resolveCitationDetailed(base(), text);
      declined(r);
      const note = r.coverage_note ?? "";
      expect(note).toContain("by description");
      // The caller did cite a number; the advice is about its form, not "cite it by number".
      expect(note).toContain("(EU)");
      expect(note).not.toContain("Cite the instrument by number");
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

describe("descriptive instrument gate: does not fire", () => {
  it("on prose that merely contains the pronoun its", () => {
    for (const text of ["paragraph 49 of its guidelines", "Article 180 CRR and its annexes", "its Article 49"]) {
      const r = resolveCitationDetailed(base(), text);
      expect(r.coverage_note ?? "").not.toContain("by description");
    }
  });

  it("on lower-case rts", () => {
    const r = resolveCitationDetailed(base(), "paragraph 49 of the rts");
    expect(r.coverage_note ?? "").not.toContain("by description");
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
