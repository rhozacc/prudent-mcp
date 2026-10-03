/**
 * Schemas for the five surfaces and supporting types.
 *
 * The TypeScript payoff over the Python version: template literal types on
 * URIs make cross-surface ID confusion a compile error.
 *
 *   const x: RegulationId = "test://foo"   // ❌ Type error
 *   const y: TestId = "regulation://foo"   // ❌ Type error
 *   check.derived_from = [someTestId]      // ❌ Type error — must be RegulationId[]
 *
 * Runtime validation via zod handles the actual format-correctness on data
 * crossing the adapter boundary.
 */
import { z } from "zod";

// --- URI types — compile-time surface segregation ----------------------------

export type RegulationId = `regulation://${string}`;
export type TestId = `test://${string}`;
export type CheckId = `check://${string}`;
export type PlaybookId = `playbook://${string}`;
export type SourceId = `source://${string}`;

/**
 * Any cross-surface reference — useful for things like Phase.references.
 * SourceId is deliberately excluded: sources join the content surfaces by
 * framework/document_id, never by URI reference.
 */
export type AnyId = RegulationId | TestId | CheckId | PlaybookId;

/**
 * What a Regulation may nest in `children`: sub-regulations plus the checks and
 * tests that operationalize it. Still typed — a PlaybookId is rejected at compile
 * time, same as the other surface IDs.
 */
export type RegulationChildId = RegulationId | TestId | CheckId;

// Zod regex validators — for runtime checks at the adapter boundary.
const regulationIdSchema = z.string().regex(/^regulation:\/\/.+/) as z.ZodType<RegulationId>;
const testIdSchema = z.string().regex(/^test:\/\/.+/) as z.ZodType<TestId>;
const checkIdSchema = z.string().regex(/^check:\/\/.+/) as z.ZodType<CheckId>;
const playbookIdSchema = z.string().regex(/^playbook:\/\/.+/) as z.ZodType<PlaybookId>;
const sourceIdSchema = z.string().regex(/^source:\/\/.+/) as z.ZodType<SourceId>;
const anyIdSchema = z.union([regulationIdSchema, testIdSchema, checkIdSchema, playbookIdSchema]);
const regulationChildIdSchema = z.union([regulationIdSchema, testIdSchema, checkIdSchema]);

// --- Regulation surface (versioned per source document) ----------------------

export const CommentarySchema = z.object({
  source: z.string(),                   // e.g. "EBA Q&A 2018_3804"
  text: z.string(),
  last_updated: z.string().date().optional(),
});
export type Commentary = z.infer<typeof CommentarySchema>;

// A citation OUT of the corpus: an instrument this corpus does not hold but
// whose provisions the record elaborates. Kept as strings, deliberately — a
// typed RegulationId would assert the target is served, and the whole point is
// that it is not. `resolve_citation` declines on these; this field is how a
// caller learns the relationship exists anyway, which is what makes "what
// operationalises CRR Article 178?" answerable at all.
export const ExternalCitationSchema = z.object({
  framework: z.string(),                 // e.g. "crr"
  citation: z.string(),                  // as the record spells it, e.g. "Article 178(1)(a)"
  document_id: z.string().optional(),    // when the record names a specific instrument
});
export type ExternalCitation = z.infer<typeof ExternalCitationSchema>;

// What sort of node a regulation record is. A section and the paragraph inside
// it are both `regulation://` records, and a caller reading a search result had
// no way to tell a document's spine from its substance.
export const ProvisionKindSchema = z.enum([
  "article",
  "paragraph",
  "point",
  "section",
  "chapter",
  "annex",
]);
export type ProvisionKind = z.infer<typeof ProvisionKindSchema>;

export const RegulationSchema = z.object({
  id: regulationIdSchema,
  framework: z.string(),                // "crr" | "eba" | "ecb" | ...
  document_id: z.string(),
  document_version: z.string(),         // e.g. "2024-01-09"
  citation: z.string(),                 // human-readable
  text: z.string(),
  commentary: z.array(CommentarySchema).default([]),
  parent: regulationIdSchema.optional(),
  // Sub-regulations plus the checks/tests that operationalize this record. A
  // check/test child MUST also name this regulation in its derived_from /
  // regulatory_basis (the mirror invariant) — that keeps get_referrers the
  // single computed reverse index rather than a second source of truth.
  children: z.array(regulationChildIdSchema).default([]),
  // --- Optional provenance and structure, all additive -----------------------
  // Every field below is optional rather than defaulted, and that is the point:
  // ABSENT IS NOT EMPTY. `pages: []` asserts the text was read from no page;
  // `pages` missing says the corpus never captured it. A consumer that cannot
  // tell those apart reports "no upcoming milestones" for a registry where
  // milestones were never populated — which is a defect this corpus has
  // already shipped once. A corpus that omits them all behaves exactly as
  // before.
  //
  // They exist because the pipeline that builds a corpus already knows these
  // things and had nowhere to put them, so each answer cost a call the caller
  // should not have had to make.
  //
  // Other spellings that name this same record. EBA guidelines number
  // PARAGRAPHS, and their range (1..~230) sits inside the CRR's article range,
  // so "Article 178" is both a real CRR article and a common (wrong) way to
  // cite EBA GL 2017/16 paragraph 178. The primary `citation` carries the
  // document's own convention; the alias keeps the loose spelling resolvable
  // without letting it masquerade as the correct one.
  citation_aliases: z.array(z.string()).optional(),
  kind: ProvisionKindSchema.optional(),
  // The provision's obligation strength, as the source words it. A reader
  // deciding whether something is required cannot get this from the text
  // without reading all of it, and "should" versus "shall" is the difference
  // between guidance and a requirement.
  obligation: z.enum(["must", "should", "may", "none"]).optional(),
  // Pages of the source document this text was read from — the citation a
  // human needs to check the quote against the PDF.
  pages: z.array(z.number().int().min(1)).optional(),
  // A verbatim snippet locating the text on its first page. Not a summary: it
  // is what makes the record auditable against the source.
  anchor: z.string().optional(),
  // true for scope/definitions/addressees provisions carrying no substantive
  // obligation. Served so a caller can skip them rather than reading each to
  // find out.
  is_metadata_only: z.boolean().optional(),
  cites: z.array(ExternalCitationSchema).optional(),
  // Future fields: supersedes, last_amended, effective_from, ...
});
export type Regulation = z.infer<typeof RegulationSchema>;

// --- Curated surfaces (latest only via MCP) ----------------------------------

export const TestSchema = z.object({
  id: testIdSchema,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  family: z.string().optional(),         // equivalence group, e.g. "calibration-binomial"
  purpose: z.string(),
  acceptance_criteria: z.string().optional(),
  regulatory_basis: z.array(regulationIdSchema).default([]),  // regulations that reference or require this test family
  // The provisions this test actually implements, as against the span
  // `regulatory_basis` covers. Must be a subset of regulatory_basis.
  primary_basis: z.array(regulationIdSchema).optional(),
  parent: regulationIdSchema.optional(),                      // set when this test hangs off a regulation as a child; must appear in regulatory_basis
  last_updated: z.string().date(),
  // Future fields: inputs, outputs, applies_to, interpretation, ...
});
export type Test = z.infer<typeof TestSchema>;

export const CheckSchema = z.object({
  id: checkIdSchema,
  name: z.string(),
  derived_from: z.array(regulationIdSchema).default([]),     // traceability to law
  // The one to three provisions this check actually restates.
  //
  // `derived_from` is a span, and on a real corpus a wide one: a median of 23
  // ids, because a check read off a section is traced to the whole section. So
  // it answers "roughly where does this come from" and cannot answer "which
  // provision is this" — and the reverse index inherits the problem, returning
  // an identical result set for every article in that section. Must be a
  // subset of derived_from.
  primary_basis: z.array(regulationIdSchema).optional(),
  parent: regulationIdSchema.optional(),                     // set when this check hangs off a regulation as a child; must appear in derived_from
  expectation: z.string(),                                    // concrete bar in plain language
  expected_evidence: z.array(z.string()).default([]),         // artifacts that evidence compliance
  last_updated: z.string().date(),
  // Future fields: severity_when_failed, references, applies_to, ...
});
export type Check = z.infer<typeof CheckSchema>;

export const PhaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  references: z.array(anyIdSchema).default([]),  // mix of regulation:// test:// check:// IDs
});
export type Phase = z.infer<typeof PhaseSchema>;

export const PlaybookSchema = z.object({
  id: playbookIdSchema,
  area: z.string(),
  subarea: z.string().optional(),
  phases: z.array(PhaseSchema).default([]),
  gates: z.array(z.string()).default([]),
  regulatory_scope: z.array(regulationIdSchema).default([]),
  last_updated: z.string().date(),
  // Future fields: prerequisites, deliverables, ...
});
export type Playbook = z.infer<typeof PlaybookSchema>;

// --- Source registry (latest only — supersession is a status + pointer) -------

export const MilestoneSchema = z.object({
  date: z.string(),                      // display string — "2026-10-19" or "Q4 2026"; never Date-parsed
  event: z.string(),                     // e.g. "Consultation closes"
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const SourceStatusSchema = z.enum(["current", "pending", "superseded"]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceSchema = z.object({
  id: sourceIdSchema,                    // source://{framework}/{document-id}, e.g. source://eba/gl-2017-16
  title: z.string(),                     // human-readable, e.g. "EBA-GL-2017-16 PD/LGD Estimation Guidelines"
  framework: z.string(),                 // "eba" | "ecb" | "crr" | ... — matches Regulation.framework
  document_id: z.string(),               // joins to Regulation.document_id (soft join, computed where needed)
  doc_type: z.enum(["regulation", "guideline", "guide", "consultation", "statement", "report", "other"]),
  status: SourceStatusSchema,
  published: z.string().date().optional(),
  effective_from: z.string().date().optional(),
  verified: z.string().date(),           // last date currency was confirmed against the publisher
  superseded_by: sourceIdSchema.optional(),  // set iff status is "superseded"
  // Upcoming regulatory dates, kept in chronological order — the first entry is
  // the next milestone; the maintenance workflow prunes past entries.
  milestones: z.array(MilestoneSchema).default([]),
  url: z.string().optional(),
  notes: z.string().optional(),
  // How much of this document the corpus holds. ABSENT means NOT DECLARED, which
  // is a third state and not a synonym for either value: a registry that never
  // recorded it cannot be read as "full" (that would assert completeness nobody
  // checked) or as "partial" (that would assert an incompleteness nobody
  // checked). Never defaulted, for the same reason `next_milestone` does not
  // read "nothing upcoming" for a registry whose milestones were never filled in.
  coverage: z.enum(["full", "partial"]).optional(),
  // Future fields: supersedes, celex_id, ...
});
export type Source = z.infer<typeof SourceSchema>;

// --- Cross-cutting types -----------------------------------------------------

export const SurfaceSchema = z.enum(["regulation", "test", "check", "playbook", "source"]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const ReferrersSchema = z.object({
  regulation: z.array(regulationIdSchema).default([]),
  tests: z.array(testIdSchema).default([]),
  checks: z.array(checkIdSchema).default([]),
  playbooks: z.array(playbookIdSchema).default([]),
  /**
   * The subset that names this provision as its PRIMARY basis — the one it
   * restates, not the span it was traced to.
   *
   * `derived_from` is wide on a real corpus (a median of 23 ids, because a
   * check read off a section is traced to the whole section), so the flat lists
   * above return an identical result set for every article in that section and
   * cannot say which provision a check actually rests on. Empty when the corpus
   * carries no `primary_basis`, which is distinguishable from "nothing restates
   * this" by whether `checks`/`tests` are empty too.
   */
  primary: z
    .object({
      tests: z.array(testIdSchema).default([]),
      checks: z.array(checkIdSchema).default([]),
    })
    .default({ tests: [], checks: [] }),
});
export type Referrers = z.infer<typeof ReferrersSchema>;

// What the corpus holds of ONE document. `coverage` on CorpusInfo names the
// documents; this says how much of each, because "CRR" in a coverage list reads
// as the whole regulation and a corpus holds a subset of its articles.
export const DocumentHoldingSchema = z.object({
  document_id: z.string(),
  framework: z.string(),
  title: z.string().optional(),          // from the matching source, when there is one
  records: z.number().int(),             // regulation records held for this document
  // true: the current source declares the document partly held; false: declares
  // it fully held; KEY ABSENT: no declaration (absent is not "full").
  partial: z.boolean().optional(),
});
export type DocumentHolding = z.infer<typeof DocumentHoldingSchema>;

export const CorpusInfoSchema = z.object({
  last_updated: z.string().datetime(),
  counts: z.record(SurfaceSchema, z.number()),
  coverage: z.array(z.string()),         // e.g. ["CRR", "EBA-GL-2017-16"]
  // Current sources whose `verified` is older than STALE_AFTER_DAYS (see
  // src/validate.ts) — computed at serve time, never stored; the default only
  // keeps stored corpus_info blocks parseable.
  stale_sources: z.array(sourceIdSchema).default([]),
  // Per-document holdings, computed at serve time from the regulation records and
  // the source registry (src/holdings.ts) — like stale_sources, never trusted from
  // a stored block. Optional because an adapter that predates it serves none, and
  // absent is not empty: [] would assert that nothing is held.
  holdings: z.array(DocumentHoldingSchema).optional(),
});
export type CorpusInfo = z.infer<typeof CorpusInfoSchema>;

export const CitationCandidateSchema = z.object({
  id: regulationIdSchema,
  citation: z.string(),
  document_id: z.string(),
});
export type CitationCandidate = z.infer<typeof CitationCandidateSchema>;

// What a loose citation resolved to, and how sure the resolver is.
//
// `match` alone cannot carry the answer "I found something numbered like that
// in a different instrument", which is the resolver's worst failure mode: the
// consumer prints it as a citation. So confidence, the candidate set, and the
// segments that went unplaced travel with the match, and a citation the corpus
// cannot place resolves to null WITH a coverage_note rather than to a
// same-numbered provision from another document.
export const CitationResolutionSchema = z.object({
  match: RegulationSchema.nullable(),
  // exact   — the record's own citation, normalized, equals the one asked for
  // segment — the numeric spine matches, scoped to the document named
  // alias    — matched one of the record's `citation_aliases`, NOT its own
  //            citation. Surfaced rather than folded into "exact" because the
  //            caller asked for a label this record does not carry: EBA
  //            guidelines number paragraphs, and "Article 178" is also a real
  //            CRR article. The consumer should quote the record's citation,
  //            not the one it typed.
  // none     — nothing matched, and nothing is being guessed
  confidence: z.enum(["exact", "segment", "alias", "none"]),
  // Every equally good match when the citation is ambiguous across documents.
  // Non-empty ⇒ match is null: picking one silently is the defect.
  candidates: z.array(CitationCandidateSchema).default([]),
  ambiguous: z.boolean().default(false),
  // Citation segments the resolver could not place — a dropped "(1)(a)" shows
  // here instead of being silently ignored.
  unmatched_segments: z.array(z.string()).default([]),
  // Why nothing was returned, when the reason is corpus coverage rather than a
  // malformed citation.
  coverage_note: z.string().optional(),
});
export type CitationResolution = z.infer<typeof CitationResolutionSchema>;

export const ReviewAreaSchema = z.object({
  id: z.string(),                        // e.g. "calibration.lgd"
  name: z.string(),
  parent: z.string().optional(),
  children: z.array(z.string()).default([]),
});
export type ReviewArea = z.infer<typeof ReviewAreaSchema>;

// Re-export id schemas if external code wants to validate inputs.
export {
  regulationIdSchema,
  testIdSchema,
  checkIdSchema,
  playbookIdSchema,
  sourceIdSchema,
  anyIdSchema,
  regulationChildIdSchema,
};
