import { describe, expect, it } from "bun:test";

import { resolveCitationDetailed, textCarriesPoint } from "../src/file-adapter.ts";
import type { Regulation } from "../src/schema.ts";

// ── Does the containing provision carry the point the citation names? ────────
//
// When a citation sits inside a record the corpus holds (rule iv), the note used
// to say "whose text carries point N" without looking. Every fixture is
// synthetic; each test builds its own records, so order does not matter.

const para = (n: number): string => `${n}. Synthetic obligation number ${n} applies to the institution.`;

/** Seven numbered paragraphs, one per line, as a consolidated act is flowed. */
const SEVEN = Array.from({ length: 7 }, (_, i) => para(i + 1)).join("\n");

/** Paragraphs 2 and 4 carry lettered points; 1, 3, 5 do not. */
const WITH_POINTS = [
  "1. Synthetic opening paragraph.",
  "2. For the purposes of paragraph 1:\n(a) first synthetic limb;\n(b) second synthetic limb;\n(c) third synthetic limb.",
  "3. Synthetic paragraph without any limbs at all.",
  "4. The following apply:\n(a) one;\n(b) two.",
  "5. Synthetic closing paragraph.",
].join("\n");

const article = (n: number, text: string): Regulation => ({
  id: `regulation://acme/article-${n}` as Regulation["id"],
  framework: "acme",
  document_id: "acme-act",
  document_version: "2024-01-09",
  citation: `Article ${n}`,
  text,
  commentary: [],
  children: [],
});

const note = (regs: Regulation[], text: string): { note: string; r: ReturnType<typeof resolveCitationDetailed> } => {
  const r = resolveCitationDetailed(regs, text);
  return { note: r.coverage_note ?? "", r };
};

describe("textCarriesPoint", () => {
  it("finds a paragraph that exists and refuses one the article does not have", () => {
    expect(textCarriesPoint(SEVEN, ["7"])).toBe("yes");
    expect(textCarriesPoint(SEVEN, ["1"])).toBe("yes");
    expect(textCarriesPoint(SEVEN, ["9"])).toBe("no");
    expect(textCarriesPoint(SEVEN, ["8"])).toBe("no");
  });

  it("scopes a point to the paragraph it was cited under", () => {
    expect(textCarriesPoint(WITH_POINTS, ["2", "b"])).toBe("yes");
    expect(textCarriesPoint(WITH_POINTS, ["4", "b"])).toBe("yes");
    // (b) exists, but under paragraphs 2 and 4 - not 3 and not 1.
    expect(textCarriesPoint(WITH_POINTS, ["3", "b"])).toBe("no");
    expect(textCarriesPoint(WITH_POINTS, ["1", "a"])).toBe("no");
    // Paragraph 4 stops at (b).
    expect(textCarriesPoint(WITH_POINTS, ["4", "c"])).toBe("no");
    // A deeper point under a missing one is missing too.
    expect(textCarriesPoint(WITH_POINTS, ["9", "a"])).toBe("no");
  });

  it("reads the same numbering when it is flowed inline rather than one item per line", () => {
    const inline =
      "Title text 1. First paragraph. 2. Second paragraph: (a) one; (b) two; and (c) three. " +
      "3. Third paragraph, with a reference to points (a) and (b) of paragraph 2.";
    expect(textCarriesPoint(inline, ["3"])).toBe("yes");
    expect(textCarriesPoint(inline, ["2", "c"])).toBe("yes");
    expect(textCarriesPoint(inline, ["3", "a"])).toBe("no");
    expect(textCarriesPoint(inline, ["4"])).toBe("no");
  });

  it("does not take a reference or an amendment marker for a paragraph", () => {
    // "paragraph 9." is a reference inside a sentence; without 1..8 before it, nothing.
    const ref = "1. Synthetic text, subject to paragraph 9. The rest follows.\n2. More synthetic text.";
    expect(textCarriesPoint(ref, ["9"])).toBe("no");
    // A consolidated-text marker in front of a paragraph does not hide it.
    expect(textCarriesPoint("1. First. ▼M8 2. Second. ▼M9 3. Third.", ["3"])).toBe("yes");
  });

  it("reads a numbering with an irregular run as unknown, never as absent or present", () => {
    // 1, 2 and 4 - the 3 is missing: asking for 4 or 5 cannot be judged by position.
    const gap = "1. one.\n2. two.\n4. four.";
    expect(textCarriesPoint(gap, ["4"])).toBe("unknown");
    expect(textCarriesPoint(gap, ["2"])).toBe("yes");
  });

  it("does not guess when the numbering cannot be read", () => {
    // Another style entirely.
    const other = "Paragraph One. Synthetic text.\nParagraph Two. Synthetic text.";
    expect(textCarriesPoint(other, ["2"])).toBe("unknown");
    expect(textCarriesPoint(other, ["1", "a"])).toBe("unknown");
    // No markers at all.
    expect(textCarriesPoint("Synthetic prose with no numbered items whatsoever.", ["1"])).toBe("unknown");
    expect(textCarriesPoint("", ["1"])).toBe("unknown");
    expect(textCarriesPoint(SEVEN, [])).toBe("unknown");
    // Inserted numbers ("1a") and roman sub-points are not read.
    expect(textCarriesPoint(SEVEN, ["1a"])).toBe("unknown");
    expect(textCarriesPoint(WITH_POINTS, ["2", "a", "i"])).toBe("unknown");
    // An earlier absence still wins over a later unreadable segment.
    expect(textCarriesPoint(WITH_POINTS, ["9", "a", "i"])).toBe("no");
  });

  it("reads (1) and 1) numbering as well as 1.", () => {
    expect(textCarriesPoint("(1) one;\n(2) two;\n(3) three.", ["3"])).toBe("yes");
    expect(textCarriesPoint("(1) one;\n(2) two;\n(3) three.", ["4"])).toBe("no");
    expect(textCarriesPoint("1) one;\n2) two.", ["2"])).toBe("yes");
  });

  it("is not satisfied by a different list sharing a letter", () => {
    // (b) appears once, under paragraph 2, as part of a reference - not as a limb of 3.
    const text = "1. One.\n2. Two, see points (a) and (b) of paragraph 1.\n3. Three.";
    expect(textCarriesPoint(text, ["2", "b"])).not.toBe("yes");
  });
});

describe("textCarriesPoint: runs on and nested lists", () => {
  it("does not call a limb absent when the text runs it on after a comma", () => {
    const text = "1. The institution shall: (a) foo, (b) bar, and (c) baz.";
    expect(textCarriesPoint(text, ["1", "b"])).not.toBe("no");
    expect(textCarriesPoint(text, ["1", "b"])).not.toBe("yes");
  });

  it("still calls a limb absent when it appears nowhere in the paragraph", () => {
    const text = "1. The institution shall: (a) foo, (b) bar.\n2. Synthetic.";
    expect(textCarriesPoint(text, ["1", "d"])).toBe("no");
  });

  it("reads the list that starts first, so an inner dot list is not the paragraphs", () => {
    const text = [
      "(1) First synthetic paragraph.",
      "(2) Second synthetic paragraph:\n1. inner one;\n2. inner two;\n3. inner three;\n4. inner four;\n5. inner five;\n6. inner six;\n7. inner seven.",
      "(3) Third.",
      "(4) Fourth.",
      "(5) Fifth.",
    ].join("\n");
    expect(textCarriesPoint(text, ["5"])).toBe("yes");
    // Paragraph 7 is only a number in the inner list: it must not be claimed.
    expect(textCarriesPoint(text, ["7"])).not.toBe("yes");
  });
});

describe("resolve_citation: the containing-provision note", () => {
  it("keeps the claim when the point is in the text", () => {
    const { note: n, r } = note([article(180, SEVEN)], "Article 180(7)");
    expect(n).toContain("whose text carries point 7");
    expect(n).toContain("Open it and quote the point from its text");
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("none");
    expect(r.unmatched_segments).toEqual(["180", "7"]);
    expect(r.candidates.map((c) => c.id)).toEqual(["regulation://acme/article-180"]);
  });

  it("does not claim a point the article does not have", () => {
    const { note: n, r } = note([article(180, SEVEN)], "Article 180(9)");
    expect(n).not.toContain("carries");
    expect(n).toContain("no point 9 was found in its text");
    expect(n).toContain("numbering may differ");
    expect(n).toContain("check before anything is cited from this resolution");
    expect(n).toContain('"Article 180"');
    expect(n).toContain("regulation://acme/article-180");
    // Nothing else about the decline changed.
    expect(r.match).toBeNull();
    expect(r.confidence).toBe("none");
    expect(r.unmatched_segments).toEqual(["180", "9"]);
    expect(r.candidates.map((c) => c.id)).toEqual(["regulation://acme/article-180"]);
  });

  it("checks a lettered point under its paragraph", () => {
    const regs = [article(180, WITH_POINTS)];
    expect(note(regs, "Article 180(2)(b)").note).toContain("whose text carries point 2.b");
    const wrong = note(regs, "Article 180(3)(b)");
    expect(wrong.note).not.toContain("carries");
    expect(wrong.note).toContain("no point 3.b was found");
  });

  it("says it could not check, rather than claiming, where the numbering is unreadable", () => {
    const styled = article(180, "Paragraph One. Synthetic text.\nParagraph Two. Synthetic text.");
    const { note: n, r } = note([styled], "Article 180(2)");
    expect(n).not.toContain("carries");
    expect(n).not.toContain("no point");
    expect(n).toContain("whether its text has point 2 could not be established");
    expect(n).toContain("Open it.");
    expect(r.candidates).toHaveLength(1);
    expect(r.match).toBeNull();
    const bare = note([article(180, "Synthetic prose with no markers.")], "Article 180(1)(a)").note;
    expect(bare).not.toContain("carries");
    expect(bare).toContain("could not be established");
  });

  it("still cannot claim that 121 contains 1218", () => {
    const { note: n, r } = note([article(121, SEVEN)], "Article 1218(2)");
    expect(r.candidates).toEqual([]);
    expect(n).not.toContain("carries");
    expect(n).not.toContain("containing it");
  });

  it("leaves an exact hit alone", () => {
    const r = resolveCitationDetailed([article(180, SEVEN)], "Article 180");
    expect(r.match?.id).toBe("regulation://acme/article-180");
    expect(r.confidence).toBe("exact");
  });
});
