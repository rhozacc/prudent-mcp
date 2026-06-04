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
  CommentarySchema,
  CorpusInfoSchema,
  PhaseSchema,
  PlaybookSchema,
  ReferrersSchema,
  RegulationSchema,
  ReviewAreaSchema,
  TestSchema,
} from "../src/schema.ts";

export const surfaceSchemas = {
  Regulation: RegulationSchema,
  Test: TestSchema,
  Check: CheckSchema,
  Playbook: PlaybookSchema,
} as const;

export const supportingSchemas = {
  Commentary: CommentarySchema,
  Phase: PhaseSchema,
  ReviewArea: ReviewAreaSchema,
  CorpusInfo: CorpusInfoSchema,
  Referrers: ReferrersSchema,
} as const;

export const schemaRegistry = { ...surfaceSchemas, ...supportingSchemas };
