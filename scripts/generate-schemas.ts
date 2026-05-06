#!/usr/bin/env bun
/**
 * Generate JSON Schemas for every corpus surface.
 *
 * Output: docs/schemas/*.schema.json
 *
 * These are the machine-readable contract for what corpus records look
 * like. Adapters and downstream tooling can validate records against these
 * as a build step — that's how an adapter stays in sync with the MCP API
 * without manual coordination.
 *
 * Usage: bun run schemas
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";

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

const surfaces = {
  Regulation: RegulationSchema,
  Test: TestSchema,
  Check: CheckSchema,
  Playbook: PlaybookSchema,
} as const;

const supporting = {
  Commentary: CommentarySchema,
  Phase: PhaseSchema,
  ReviewArea: ReviewAreaSchema,
  CorpusInfo: CorpusInfoSchema,
  Referrers: ReferrersSchema,
} as const;

const outDir = resolve("docs/schemas");
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries({ ...surfaces, ...supporting })) {
  const json = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  });
  const path = resolve(outDir, `${name}.schema.json`);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`  wrote ${path}`);
}

console.log(`\nDone. ${Object.keys(surfaces).length} surfaces + ${Object.keys(supporting).length} supporting types.`);
