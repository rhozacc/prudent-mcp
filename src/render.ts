/**
 * Playbook rendering: a compiled playbook as the text a model reads, deterministic.
 *
 * Three rules shape it.
 *
 * - Text, not JSON. Short headings and paragraphs; nothing the model has to unpack.
 * - Citations come from ids, never from the compiler. A provision id renders as the document's official citation
 *   (`citationOf`), so a model that did not write a citation cannot have misattributed it. Where the compiler's own
 *   citation for a source adds a pinpoint to the one its ids give ("Art. 174(c) CRR" for the Article 174 record), the
 *   pinpoint is kept; anywhere else the id's citation wins.
 * - No internal ids. A requirement carries a handle (`R4`) a caller can ask for; a provision is named by citation.
 *
 * Force is labelled on every basis line, and a method that is market practice says so in so many words.
 */
import { citationOf, locatorOf, sourceFor } from "./citation-style.ts";
import { approxTokens, type PlaybookContext } from "./playbook-context.ts";
import type { CompiledPlaybook, PlaybookForce, Regulation, RegulationId } from "./schema.ts";

/** A full playbook render is held to this many tokens (the verifier's V6 uses the same figure). */
export const FULL_RENDER_BUDGET = 7000;
/** The share of the response `brief` gives its playbook. */
export const BRIEF_RENDER_BUDGET = 5000;
/** One requirement with the full text of its provisions. */
export const SECTION_RENDER_BUDGET = 5000;

export interface RenderOptions {
  /** Tokens. Defaults to the full-render budget, or the section budget when `section` is given. */
  budget?: number;
  /** A requirement handle ("R4"): that requirement, with the full text of its provisions. */
  section?: string;
}

export interface Rendered {
  text: string;
  tokens: number;
  /** Handles of requirements shown in short form to fit the budget. */
  abridged: string[];
}

export const FORCE_LABELS: Record<PlaybookForce, string> = {
  law: "law",
  delegated_act: "delegated act",
  guideline: "guideline",
  supervisory_expectation: "supervisory expectation",
  other: "other",
};

/** `(law)`, `(EBA guideline)`, `(ECB supervisory expectation)`: the issuer is read from the first provision's framework. */
export function forceLabel(force: PlaybookForce, framework?: string): string {
  if (force === "guideline" && framework === "eba") return "EBA guideline";
  if (force === "supervisory_expectation" && framework === "ecb") return "ECB supervisory expectation";
  return FORCE_LABELS[force];
}

const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)];

/** The citations of provision ids, in order, without repeats. Ids the context does not hold are left out, never printed. */
function citationsOf(ids: readonly RegulationId[], ctx: PlaybookContext): string[] {
  return dedupe(
    ids.flatMap((id) => {
      const reg = ctx.regulations.get(id);
      return reg === undefined ? [] : [citationOf(reg, sourceFor(reg, ctx.sources))];
    }),
  );
}

/** Whether `authored` is the id-derived citation plus a pinpoint ("Art. 174(c) CRR" over "Art. 174 CRR"). */
function extendsLocator(authored: string, derived: string): boolean {
  const a = locatorOf(authored);
  const d = locatorOf(derived);
  if (a === null || d === null) return false;
  return a === d || a.startsWith(`${d}(`);
}

/** The citation printed for a basis entry: from its provisions, keeping the compiler's pinpoint only where it extends them. */
export function basisCitation(entry: CompiledPlaybook["basis"][number], ctx: PlaybookContext): string {
  const derived = citationsOf(entry.provisions.map((p) => p.id), ctx);
  if (derived.length === 0) return entry.citation;
  if (derived.some((d) => extendsLocator(entry.citation, d))) return entry.citation;
  return derived.join("; ");
}

const quoteLine = (quote: string, citation: string): string => `> "${quote}" (${citation})`;

function provisionQuotes(
  refs: readonly { id: RegulationId; quote?: string | undefined }[],
  ctx: PlaybookContext,
): string[] {
  return refs.flatMap((r) => {
    const reg = ctx.regulations.get(r.id);
    return reg === undefined || r.quote === undefined ? [] : [quoteLine(r.quote, citationOf(reg, sourceFor(reg, ctx.sources)))];
  });
}

function header(pb: CompiledPlaybook, ctx: PlaybookContext): string {
  const out = [`# ${pb.title}`, "", pb.summary, "", "## What it rests on", ""];
  for (const b of pb.basis) {
    const lead = b.provisions[0];
    const first = lead === undefined ? undefined : ctx.regulations.get(lead.id);
    out.push(`- ${basisCitation(b, ctx)} (${forceLabel(b.force, first?.framework)}): ${b.role}`);
    for (const q of provisionQuotes(b.provisions, ctx)) out.push(`  ${q}`);
  }
  return out.join("\n");
}

function requirementBlock(pb: CompiledPlaybook, handle: string, ctx: PlaybookContext, compact: boolean): string {
  const r = pb.requirements.find((x) => x.id === handle)!;
  const sources = citationsOf(r.provisions.map((p) => p.id), ctx);
  const out = [`### ${r.id}. ${r.title}`];
  if (compact) {
    if (sources.length > 0) out.push(`Sources: ${sources.join("; ")}.`);
    out.push(`[Abridged to fit. Ask for section ${r.id} to see it in full.]`);
    return out.join("\n");
  }
  out.push(r.statement);
  if (sources.length > 0) out.push(`Sources: ${sources.join("; ")}.`);
  out.push(...provisionQuotes(r.provisions, ctx));
  if (r.evidence.length > 0) out.push(`A reviewer will ask to see: ${r.evidence.join("; ")}.`);
  const checks = r.checks.flatMap((id) => (ctx.checks?.get(id) === undefined ? [] : [ctx.checks.get(id)!.name]));
  if (checks.length > 0) out.push(`Checks: ${checks.join("; ")}.`);
  const tests = r.tests.flatMap((id) => (ctx.tests?.get(id) === undefined ? [] : [ctx.tests.get(id)!.name]));
  if (tests.length > 0) out.push(`Tests: ${tests.join("; ")}.`);
  return out.join("\n");
}

function tail(pb: CompiledPlaybook, ctx: PlaybookContext): string {
  const out: string[] = [];
  if (pb.methods.length > 0) {
    out.push("## Methods", "");
    for (const m of pb.methods) {
      const label = m.basis === "practice" ? "market practice, not a regulatory requirement" : "regulatory";
      const src = citationsOf(m.provisions, ctx);
      out.push(`- ${m.name} (${label}${src.length > 0 ? `; ${src.join("; ")}` : ""}): ${m.description}`);
    }
    out.push("");
  }
  if (pb.pitfalls.length > 0) {
    out.push("## Pitfalls", "");
    for (const p of pb.pitfalls) {
      const src = citationsOf(p.provisions, ctx);
      out.push(`- ${p.text}${src.length > 0 ? ` (${src.join("; ")})` : ""}`);
    }
    out.push("");
  }
  if (pb.outside_library.length > 0) {
    out.push("## Not in this library", "");
    for (const o of pb.outside_library) out.push(`- ${o.name}: ${o.why}`);
    out.push("");
  }
  const related = pb.related.flatMap((id) => (ctx.playbooks?.get(id) === undefined ? [] : [ctx.playbooks.get(id)!.title]));
  if (related.length > 0) out.push("## See also", "", ...related.map((t) => `- ${t}`), "");
  return out.join("\n").trimEnd();
}

/** Cut `text` at the last sentence or clause end inside `max` characters; never mid-word. */
function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end > max * 0.4) return head.slice(0, end + 1);
  const space = head.lastIndexOf(" ");
  return head.slice(0, space > 0 ? space : max);
}

function renderSection(pb: CompiledPlaybook, handle: string, ctx: PlaybookContext, budget: number): Rendered | null {
  const r = pb.requirements.find((x) => x.id === handle);
  if (r === undefined) return null;
  const out = [`# ${r.id}. ${r.title}`, `From: ${pb.title}`, "", r.statement, ""];
  if (r.evidence.length > 0) out.push(`A reviewer will ask to see: ${r.evidence.join("; ")}.`, "");
  const checks = r.checks.flatMap((id) => (ctx.checks?.get(id) === undefined ? [] : [ctx.checks.get(id)!]));
  for (const c of checks) out.push(`Check: ${c.name}. ${c.expectation}`);
  const tests = r.tests.flatMap((id) => (ctx.tests?.get(id) === undefined ? [] : [ctx.tests.get(id)!]));
  for (const t of tests) out.push(`Test: ${t.name}. ${t.purpose}`);
  if (checks.length + tests.length > 0) out.push("");
  out.push("## The provisions", "");
  const fixed = approxTokens(out.join("\n"));
  const regs: Regulation[] = r.provisions.flatMap((p) => (ctx.regulations.has(p.id) ? [ctx.regulations.get(p.id)!] : []));
  // Each provision gets an equal share of what is left, and a short one gives its unused share back.
  let room = Math.max(budget - fixed, 0) * 4;
  const abridged: string[] = [];
  regs.forEach((reg, i) => {
    const share = room / (regs.length - i);
    const cite = citationOf(reg, sourceFor(reg, ctx.sources));
    const body = cutAtBoundary(reg.text, Math.max(Math.floor(share) - cite.length - 8, 200));
    room -= body.length + cite.length + 8;
    const cut = body.length < reg.text.length;
    if (cut) abridged.push(cite);
    out.push(`### ${cite}`, body + (cut ? " [Cut for length.]" : ""), "");
  });
  const text = out.join("\n").trimEnd();
  return { text, tokens: approxTokens(text), abridged };
}

/**
 * The playbook as text. With `section`, one requirement and the full text of its provisions (null when the handle
 * names no requirement). Without, the whole playbook; when it would exceed the budget the later requirements are
 * shown in short form, each saying how to ask for it in full.
 */
export function renderPlaybook(pb: CompiledPlaybook, ctx: PlaybookContext, opts: RenderOptions = {}): Rendered | null {
  if (opts.section !== undefined) return renderSection(pb, opts.section, ctx, opts.budget ?? SECTION_RENDER_BUDGET);
  const budget = opts.budget ?? FULL_RENDER_BUDGET;
  const head = header(pb, ctx);
  const foot = tail(pb, ctx);
  const handles = pb.requirements.map((r) => r.id);
  const compact = new Set<string>();
  const assemble = (): string => {
    const blocks = handles.map((h) => requirementBlock(pb, h, ctx, compact.has(h)));
    return [head, "", "## What has to be shown", "", blocks.join("\n\n"), ...(foot === "" ? [] : ["", foot])].join("\n");
  };
  let text = assemble();
  for (let i = handles.length - 1; i >= 0 && approxTokens(text) > budget; i--) {
    compact.add(handles[i]!);
    text = assemble();
  }
  return { text, tokens: approxTokens(text), abridged: handles.filter((h) => compact.has(h)) };
}
