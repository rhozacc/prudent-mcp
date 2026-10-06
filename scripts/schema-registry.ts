/**
 * The single list of named schemas the JSON Schema contract exports.
 *
 * Shared by `scripts/generate-schemas.ts` (which writes the files) and
 * `tests/schema-drift.test.ts` (which asserts the committed files still match).
 * Keeping one source means the generator and the drift guard can never disagree
 * about which schemas exist or what options produce them.
 */
import {
  CheckSchema,
  CitationResolutionSchema,
  ExternalCitationSchema,
  CommentarySchema,
  CompiledPlaybookSchema,
  CorpusInfoSchema,
  MilestoneSchema,
  PhaseSchema,
  PlaybookSchema,
  ReferrersSchema,
  RegulationSchema,
  ReviewAreaSchema,
  SourceSchema,
  TestSchema,
  TopicsSchema,
} from "../src/schema.ts";

export const surfaceSchemas = {
  Regulation: RegulationSchema,
  Test: TestSchema,
  Check: CheckSchema,
  Playbook: PlaybookSchema,
  Source: SourceSchema,
} as const;

export const supportingSchemas = {
  Commentary: CommentarySchema,
  Phase: PhaseSchema,
  Milestone: MilestoneSchema,
  ReviewArea: ReviewAreaSchema,
  CorpusInfo: CorpusInfoSchema,
  Referrers: ReferrersSchema,
  CitationResolution: CitationResolutionSchema,
  ExternalCitation: ExternalCitationSchema,
  // The 1.0 playbook and the topics it is compiled from. Registered beside the 0.x `Playbook`, which it replaces in 1.0.0.
  CompiledPlaybook: CompiledPlaybookSchema,
  Topics: TopicsSchema,
} as const;

export const schemaRegistry = { ...surfaceSchemas, ...supportingSchemas };
