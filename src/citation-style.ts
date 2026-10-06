/**
 * The official citation of a provision.
 *
 * A model that writes its own citations misattributes them: it quoted Art. 179(1)(d) for the words of Art. 174(c).
 * So a rendered playbook never takes a citation from the model. It takes the provision's id, finds the provision and
 * its document's citation style, and writes the citation a practitioner would: `Art. 179(1)(d) CRR`,
 * `EBA/GL/2017/16 para 28`, `ECB guide to internal models, Model validation chapter, para 233`.
 *
 * `citationOf` is the ONE definition. It never guesses: when the pinpoint cannot be read from the record's own
 * `citation` it returns that citation unchanged, which is always true even when it is not pretty.
 */
import type { Regulation, Source } from "./schema.ts";

/** The source that describes a regulation's document: same framework and document id, a current one first. */
export function sourceFor(reg: Pick<Regulation, "framework" | "document_id">, sources: readonly Source[]): Source | undefined {
  const same = sources.filter((s) => s.framework === reg.framework && s.document_id === reg.document_id);
  return same.find((s) => s.status === "current") ?? same[0];
}

// An article number with its pinpoint: 178, 179(1)(d), 105.13, 4a.
const ARTICLE = /\bArt(?:icle|\.)?\s*(\d[\w.]*(?:\s*\(\s*\w+\s*\))*)/i;
const PARAGRAPH = /\bpara(?:graph|\.)?\s*(\d[\w.]*)/i;
const CHAPTER_PARA = /\bChapter\s*(\d+)\b[^]*?\bpara(?:graph|\.)?\s*(\d[\w.]*)/i;

const tight = (pinpoint: string): string => pinpoint.replace(/\s+/g, "");

export function citationOf(reg: Pick<Regulation, "citation">, source?: Source): string {
  const style = source?.citation_style;
  const name = style?.short_name;
  if (style === undefined || name === undefined) return reg.citation;
  switch (style.kind) {
    case "eu-regulation": {
      const m = ARTICLE.exec(reg.citation);
      return m === null ? reg.citation : `Art. ${tight(m[1]!)} ${name}`;
    }
    case "eba-gl": {
      const m = PARAGRAPH.exec(reg.citation);
      return m === null ? reg.citation : `${name} para ${m[1]}`;
    }
    case "ecb-guide": {
      const m = CHAPTER_PARA.exec(reg.citation);
      if (m === null) return reg.citation;
      const chapter = style.chapters?.[m[1]!];
      return chapter === undefined ? `${name}, Ch. ${m[1]} para ${m[2]}` : `${name}, ${chapter} chapter, para ${m[2]}`;
    }
    case "generic":
      return reg.citation;
  }
}

/**
 * Where a citation points, as a comparable key: `art:179(1)(d)`, `para:28`, `ch4.para:26`. Two citations name
 * the same place when their keys are equal. `null` when the record's citation carries no number to compare.
 * Used by the verifier to tell which provision a sentence of prose is talking about.
 */
export function locatorOf(citation: string): string | null {
  const cp = CHAPTER_PARA.exec(citation);
  if (cp !== null) return `ch${cp[1]}.para:${cp[2]!.toLowerCase()}`;
  const a = ARTICLE.exec(citation);
  if (a !== null) return `art:${tight(a[1]!).toLowerCase()}`;
  const p = PARAGRAPH.exec(citation);
  if (p !== null) return `para:${p[1]!.toLowerCase()}`;
  return null;
}
