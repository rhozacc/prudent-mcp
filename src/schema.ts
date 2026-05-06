/**
 * Schemas for the four surfaces and supporting types.
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

/** Any cross-surface reference — useful for things like Phase.references. */
export type AnyId = RegulationId | TestId | CheckId | PlaybookId;

// Zod regex validators — for runtime checks at the adapter boundary.
const regulationIdSchema = z.string().regex(/^regulation:\/\/.+/) as z.ZodType<RegulationId>;
const testIdSchema = z.string().regex(/^test:\/\/.+/) as z.ZodType<TestId>;
const checkIdSchema = z.string().regex(/^check:\/\/.+/) as z.ZodType<CheckId>;
const playbookIdSchema = z.string().regex(/^playbook:\/\/.+/) as z.ZodType<PlaybookId>;
const anyIdSchema = z.union([regulationIdSchema, testIdSchema, checkIdSchema, playbookIdSchema]);

// --- Regulation surface (versioned per source document) ----------------------

export const CommentarySchema = z.object({
  source: z.string(),                   // e.g. "EBA Q&A 2018_3804"
  text: z.string(),
  last_updated: z.string().date().optional(),
});
export type Commentary = z.infer<typeof CommentarySchema>;

export const RegulationSchema = z.object({
  id: regulationIdSchema,
  framework: z.string(),                // "crr" | "eba" | "ecb" | ...
  document_id: z.string(),
  document_version: z.string(),         // e.g. "2024-01-09"
  citation: z.string(),                 // human-readable
  text: z.string(),
  commentary: z.array(CommentarySchema).default([]),
  // Future fields: parents, children, supersedes, last_amended, effective_from, ...
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
  last_updated: z.string().date(),
  // Future fields: inputs, outputs, applies_to, references, interpretation, ...
});
export type Test = z.infer<typeof TestSchema>;

export const CheckSchema = z.object({
  id: checkIdSchema,
  name: z.string(),
  derived_from: z.array(regulationIdSchema).default([]),  // traceability to law
  expectation: z.string(),                                 // concrete bar in plain language
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
  last_updated: z.string().date(),
  // Future fields: prerequisites, deliverables, ...
});
export type Playbook = z.infer<typeof PlaybookSchema>;

// --- Cross-cutting types -----------------------------------------------------

export const SurfaceSchema = z.enum(["regulation", "test", "check", "playbook"]);
export type Surface = z.infer<typeof SurfaceSchema>;

export const ReferrersSchema = z.object({
  regulation: z.array(regulationIdSchema).default([]),
  tests: z.array(testIdSchema).default([]),
  checks: z.array(checkIdSchema).default([]),
  playbooks: z.array(playbookIdSchema).default([]),
});
export type Referrers = z.infer<typeof ReferrersSchema>;

export const CorpusInfoSchema = z.object({
  last_updated: z.string().datetime(),
  counts: z.record(SurfaceSchema, z.number()),
  coverage: z.array(z.string()),         // e.g. ["CRR", "EBA-GL-2017-16"]
});
export type CorpusInfo = z.infer<typeof CorpusInfoSchema>;

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
  anyIdSchema,
};
