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
  CorpusInfoSchema,
  MilestoneSchema,
  PlaybookSchema,
  ReferrersSchema,
  RegulationSchema,
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
  Milestone: MilestoneSchema,
  CorpusInfo: CorpusInfoSchema,
  Referrers: ReferrersSchema,
  CitationResolution: CitationResolutionSchema,
  ExternalCitation: ExternalCitationSchema,
  // The topics the playbooks are compiled from.
  Topics: TopicsSchema,
} as const;

export const schemaRegistry = { ...surfaceSchemas, ...supportingSchemas };
