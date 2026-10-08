/**
 * The playbook verifier: pure, and the gate between a compiled draft and anything a person reads.
 *
 * `verifyPlaybook(playbook, context, options)` returns findings; any ERROR blocks publishing. The compiler is a model, and
 * a model's playbook is only as good as what can be checked mechanically, so the checks are the ones that catch the
 * failures actually seen: a quote the provision does not say, a provision named in a sentence but not cited, a
 * member provision silently dropped (stopping at paragraph 28 of 37), a requirement invented from market practice.
 *
 * | rule | error when |
 * |---|---|
 * | V1 | an id (provision, check, test, related playbook, excluded) does not resolve |
 * | V2 | a quote is not a whitespace-normalised substring of its provision, or is over 300 characters |
 * | V3 | prose names a provision of a held document that is not among that passage's cited provisions or the basis |
 * | V4 | a member provision is neither cited nor excluded with a reason (given a member list) |
 * | V5 | prose uses plumbing vocabulary (corpus, ingest, registry, adapter, "record id"), a tool or field name, or "the library holds" |
 * | V6 | a budget: summary over 180 words, a statement over 220, the full render over 7,000 tokens |
 * | V7 | `law` basis with no regulation provision; a `practice` method that lists provisions |
 * | V8 | an `outside_library` instrument is in fact held |
 *
 * Warnings never block: a requirement with no evidence, no checks while member checks exist, `related` pointing at an
 * unapproved playbook, a basis citation its own provisions do not support, a regulatory method naming no provision.
 */
import { locatorOf, citationOf, sourceFor } from "./citation-style.ts";
import { approxTokens, wordCount, type PlaybookContext } from "./playbook-context.ts";
import { BANNED_TERMS, identifiersIn } from "./language.ts";
import { FULL_RENDER_BUDGET, basisCitation, renderPlaybook } from "./render.ts";
import type { Playbook, Regulation, RegulationId } from "./schema.ts";

export type PlaybookRule = "V1" | "V2" | "V3" | "V4" | "V5" | "V6" | "V7" | "V8" | "W";

export interface Finding {
  rule: PlaybookRule;
  /** Where: "summary", "requirements.R2.statement", "basis[1].provisions[0].quote". */
  where: string;
  message: string;
}

export interface Verification {
  errors: Finding[];
  warnings: Finding[];
}

export interface VerifyOptions {
  /** The provisions the topic's membership step assigned to it. V4 is checked only when this is given. */
  members?: readonly RegulationId[];
}

export const SUMMARY_WORDS = 180;
export const STATEMENT_WORDS = 220;
export const QUOTE_CHARS = 300;

/**
 * What V5 bans in playbook prose: the language rule's list without the words a practitioner uses in their own
 * sense. "Record" ("a track record", "keep a record of the decision"), "holdings" and "served" are ordinary credit-risk
 * English; in server notices they describe storage, in a playbook they do not. "Record id" is the plumbing sense.
 */
const ORDINARY_ENGLISH = new Set(["record", "records", "holdings", "served"]);
const PLAYBOOK_BANNED = BANNED_TERMS.filter((t) => !ORDINARY_ENGLISH.has(t));
const PLAYBOOK_BANNED_RE = new RegExp(`\\b(?:${PLAYBOOK_BANNED.map((t) => t.replace(/ /g, "\\s+")).join("|")}|record\\s+ids?)\\b`, "gi");

const IDENTIFIER_FOR_V5 = /`[^`]*`|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

const ABBREVIATION = /^(?:e\.g|i\.e)$/i;

const squash = (text: string): string => text.normalize("NFC").replace(/\s+/g, " ").trim();

// --- V3: which provision does a sentence name? --------------------------------------------------------

/** Numbers after "para(s)"/"Art(s)." and the like, with ranges and lists expanded, as locators. */
function mentionsIn(text: string): string[] {
  const out: string[] = [];
  const chapterPara = /\bCh(?:apter|\.)?\s*(\d+)\b[^.;]{0,40}?\bpara(?:graph)?s?\.?\s*(\d[\w.]*)/gi;
  for (const m of text.matchAll(chapterPara)) out.push(`ch${m[1]}.para:${m[2]!.toLowerCase()}`);
  const withoutChapters = text.replace(chapterPara, " ");
  const para = /\bparas?(?:graphs?)?\.?\s*((?:\d+[\w.]*)(?:\s*(?:,|and|&|[-–])\s*\d+[\w.]*)*)/gi;
  for (const m of withoutChapters.matchAll(para)) {
    for (const n of expandRun(m[1]!)) out.push(`para:${n}`);
  }
  const art = /\bArt(?:icles?|s?\.)?\s*(\d[\w.]*(?:\s*\(\s*\w+\s*\))*)/gi;
  for (const m of text.matchAll(art)) out.push(`art:${m[1]!.replace(/\s+/g, "").toLowerCase()}`);
  return out;
}

/** "29, 31-33" -> 29, 31, 32, 33; a run that is not plain integers is returned as written. */
function expandRun(run: string): string[] {
  const parts = run.split(/\s*(?:,|and|&)\s*/i);
  const out: string[] = [];
  for (const part of parts) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part.trim());
    if (range !== null && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 60) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
    } else if (part.trim() !== "") out.push(part.trim().toLowerCase());
  }
  return out;
}

/** Whether two locators name the same place, or one is the container of the other ("art:179" holds "art:179(1)(d)"). */
function sameOrNested(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}(`) || b.startsWith(`${a}(`);
}

function locatorsOfIds(ids: Iterable<RegulationId>, ctx: PlaybookContext): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const reg = ctx.regulations.get(id);
    const key = reg === undefined ? null : locatorOf(reg.citation);
    if (key !== null) out.push(key);
  }
  return out;
}

// --- the verifier -------------------------------------------------------------------------------------

export function verifyPlaybook(pb: Playbook, ctx: PlaybookContext, opts: VerifyOptions = {}): Verification {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const err = (rule: PlaybookRule, where: string, message: string): void => void errors.push({ rule, where, message });
  const warn = (where: string, message: string): void => void warnings.push({ rule: "W", where, message });

  // Every provision id the playbook cites anywhere, for V3 and V4.
  const basisIds = new Set<RegulationId>(pb.basis.flatMap((b) => b.provisions.map((p) => p.id)));
  const citedIds = new Set<RegulationId>(basisIds);
  for (const r of pb.requirements) for (const p of r.provisions) citedIds.add(p.id);
  for (const m of pb.methods) for (const id of m.provisions) citedIds.add(id);
  for (const p of pb.pitfalls) for (const id of p.provisions) citedIds.add(id);

  // V1 / V2: ids, and the quotes beside them.
  const checkRef = (id: RegulationId, where: string, quote?: string): void => {
    const reg = ctx.regulations.get(id);
    if (reg === undefined) return err("V1", where, `provision does not resolve: ${id}`);
    if (quote !== undefined) {
      if (quote.length > QUOTE_CHARS) err("V2", `${where}.quote`, `quote is ${quote.length} characters; the limit is ${QUOTE_CHARS}`);
      if (!squash(reg.text).includes(squash(quote))) err("V2", `${where}.quote`, `quote is not in ${citationOf(reg, sourceFor(reg, ctx.sources))}: "${quote.slice(0, 80)}"`);
    }
  };
  pb.basis.forEach((b, i) => b.provisions.forEach((p, j) => checkRef(p.id, `basis[${i}].provisions[${j}]`, p.quote)));
  for (const r of pb.requirements) {
    r.provisions.forEach((p, j) => checkRef(p.id, `requirements.${r.id}.provisions[${j}]`, p.quote));
    for (const id of r.checks) if (ctx.checks !== undefined && !ctx.checks.has(id)) err("V1", `requirements.${r.id}.checks`, `check does not resolve: ${id}`);
    for (const id of r.tests) if (ctx.tests !== undefined && !ctx.tests.has(id)) err("V1", `requirements.${r.id}.tests`, `test does not resolve: ${id}`);
  }
  pb.methods.forEach((m, i) => m.provisions.forEach((id, j) => checkRef(id, `methods[${i}].provisions[${j}]`)));
  pb.pitfalls.forEach((p, i) => p.provisions.forEach((id, j) => checkRef(id, `pitfalls[${i}].provisions[${j}]`)));
  pb.excluded.forEach((e, i) => checkRef(e.id, `excluded[${i}]`));
  if (ctx.playbooks !== undefined) {
    for (const id of pb.related) {
      const other = ctx.playbooks.get(id);
      if (other === undefined) err("V1", "related", `playbook does not resolve: ${id}`);
      else if (other.status === "draft") warn("related", `${id} is not approved yet`);
    }
  }

  // V3: a provision named in prose must be one the passage cites (or the basis does).
  const held = (loc: string): boolean => {
    for (const reg of ctx.regulations.values()) {
      const k = locatorOf(reg.citation);
      if (k !== null && sameOrNested(k, loc)) return true;
    }
    return false;
  };
  const prose = (where: string, text: string, cited: Iterable<RegulationId>): void => {
    const allowed = locatorsOfIds(new Set([...basisIds, ...cited]), ctx);
    for (const mention of new Set(mentionsIn(withoutQuotes(text)))) {
      if (allowed.some((a) => sameOrNested(a, mention))) continue;
      if (held(mention)) err("V3", where, `names ${describe(mention)}, which is held but not cited here`);
    }
  };
  prose("summary", pb.summary, citedIds);
  for (const r of pb.requirements) {
    const own = r.provisions.map((p) => p.id);
    prose(`requirements.${r.id}.statement`, r.statement, own);
    r.evidence.forEach((e, i) => prose(`requirements.${r.id}.evidence[${i}]`, e, own));
  }
  pb.methods.forEach((m, i) => prose(`methods[${i}].description`, m.description, m.provisions));
  pb.pitfalls.forEach((p, i) => prose(`pitfalls[${i}].text`, p.text, p.provisions));

  // V4: completeness.
  if (opts.members !== undefined) {
    const excluded = new Map(pb.excluded.map((e) => [e.id, e.reason]));
    const missing = opts.members.filter((id) => !citedIds.has(id) && !(excluded.get(id) ?? "").trim());
    if (missing.length > 0) {
      const names = missing.map((id) => {
        const reg = ctx.regulations.get(id);
        return reg === undefined ? id : citationOf(reg, sourceFor(reg, ctx.sources));
      });
      err("V4", "provisions", `${missing.length} member provision(s) are neither cited nor excluded with a reason: ${names.join(", ")}`);
    }
  }

  // V5: the language rule, on everything a user may be told.
  const language = (where: string, text: string): void => {
    // Identifiers and quotations are not the compiler's prose; the same carve-outs as the language rule.
    const prose = withoutQuotes(text).replace(IDENTIFIER_FOR_V5, " ");
    for (const t of new Set([...prose.matchAll(PLAYBOOK_BANNED_RE)].map((m) => m[0].toLowerCase().replace(/\s+/g, " ")))) err("V5", where, `uses "${t}"`);
    // "e.g." and "i.e." read as dotted paths to the identifier pattern; they are abbreviations, not field names.
    for (const id of new Set(identifiersIn(text).filter((x) => !ABBREVIATION.test(x)))) err("V5", where, `contains an identifier: ${id}`);
    if (/\bthe library holds\b/i.test(withoutQuotes(text))) err("V5", where, 'says "the library holds"');
    if (/\bthis server\b/i.test(withoutQuotes(text))) err("V5", where, 'says "this server"');
  };
  language("summary", pb.summary);
  language("title", pb.title);
  for (const r of pb.requirements) {
    language(`requirements.${r.id}.title`, r.title);
    language(`requirements.${r.id}.statement`, r.statement);
    r.evidence.forEach((e, i) => language(`requirements.${r.id}.evidence[${i}]`, e));
  }
  pb.basis.forEach((b, i) => language(`basis[${i}].role`, b.role));
  pb.methods.forEach((m, i) => {
    language(`methods[${i}].name`, m.name);
    language(`methods[${i}].description`, m.description);
  });
  pb.pitfalls.forEach((p, i) => language(`pitfalls[${i}].text`, p.text));
  pb.outside_library.forEach((o, i) => language(`outside_library[${i}].why`, o.why));

  // V6: budgets.
  const sw = wordCount(pb.summary);
  if (sw > SUMMARY_WORDS) err("V6", "summary", `${sw} words; the limit is ${SUMMARY_WORDS}`);
  for (const r of pb.requirements) {
    const n = wordCount(r.statement);
    if (n > STATEMENT_WORDS) err("V6", `requirements.${r.id}.statement`, `${n} words; the limit is ${STATEMENT_WORDS}`);
  }
  // Rendered with room to spare, so what is measured is the playbook and not what the renderer chose to abridge.
  const full = renderPlaybook(pb, ctx, { budget: Number.MAX_SAFE_INTEGER });
  if (full !== null && full.tokens > FULL_RENDER_BUDGET) err("V6", "render", `the full render is about ${full.tokens} tokens; the limit is ${FULL_RENDER_BUDGET}`);

  // V7: force against basis.
  pb.basis.forEach((b, i) => {
    if (b.force !== "law") return;
    const regs = b.provisions.flatMap((p) => (ctx.regulations.has(p.id) ? [ctx.regulations.get(p.id)!] : []));
    if (!regs.some((r) => isRegulationProvision(r, ctx))) err("V7", `basis[${i}]`, `"${b.citation}" is marked law but cites no provision of a regulation`);
  });
  pb.methods.forEach((m, i) => {
    if (m.basis === "practice" && m.provisions.length > 0) err("V7", `methods[${i}]`, `"${m.name}" is market practice but lists provisions`);
    if (m.basis === "regulatory" && m.provisions.length === 0) warn(`methods[${i}]`, `"${m.name}" is marked regulatory but names no provision`);
  });

  // V8: an instrument said to be outside the library must not be inside it.
  pb.outside_library.forEach((o, i) => {
    const hit = heldInstrument(o.name, ctx);
    if (hit !== null) err("V8", `outside_library[${i}]`, `"${o.name}" is held (${hit}); cite it instead`);
  });

  // Warnings.
  const memberChecks = ctx.checks === undefined ? [] : [...ctx.checks.values()];
  for (const r of pb.requirements) {
    if (r.evidence.length === 0) warn(`requirements.${r.id}`, "no evidence listed");
    if (r.checks.length === 0 && memberChecks.some((c) => (c.primary_basis ?? c.derived_from).some((id) => r.provisions.some((p) => p.id === id)))) {
      warn(`requirements.${r.id}`, "no checks, though checks rest on its provisions");
    }
  }
  pb.basis.forEach((b, i) => {
    if (b.provisions.length === 0) return;
    const printed = basisCitation(b, ctx);
    if (printed !== b.citation) warn(`basis[${i}]`, `citation "${b.citation}" does not match its provisions; printed as "${printed}"`);
  });

  return { errors, warnings };
}

// --- helpers ------------------------------------------------------------------------------------------

/** Text outside double quotes: a quotation is the law's words, not the compiler's claim. */
const withoutQuotes = (text: string): string => text.replace(/"[^"\n]*"|“[^”\n]*”/g, " ");

function describe(locator: string): string {
  const [kind, rest] = locator.split(":") as [string, string];
  if (kind === "art") return `Art. ${rest}`;
  if (kind === "para") return `para ${rest}`;
  return locator;
}

/** A regulation provision (law), as against a guideline or guide: its source is styled eu-regulation, or its framework is the CRR/CRD. */
function isRegulationProvision(reg: Regulation, ctx: PlaybookContext): boolean {
  const style = sourceFor(reg, ctx.sources)?.citation_style?.kind;
  return style === "eu-regulation" || reg.framework === "crr" || reg.framework === "crd";
}

/** The numbered-act keys in a string: 2022/439, 575/2013. */
const actKeys = (text: string): string[] => [...text.matchAll(/\b(\d{4}\/\d{1,4}|\d{1,4}\/\d{4})\b/g)].map((m) => m[1]!);

const token = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which held source `name` names, by short name, document id or act number; null when none. Whole tokens, never substrings. */
function heldInstrument(name: string, ctx: PlaybookContext): string | null {
  const padded = ` ${token(name)} `;
  const acts = new Set(actKeys(name));
  for (const s of ctx.sources) {
    if (s.status !== "current") continue;
    const labels = [s.citation_style?.short_name, s.document_id].filter((x): x is string => x !== undefined && token(x) !== "");
    if (labels.some((l) => padded.includes(` ${token(l)} `))) return s.title;
    if ([s.title, s.citation_style?.short_name ?? ""].some((t) => actKeys(t).some((k) => acts.has(k)))) return s.title;
  }
  return null;
}
