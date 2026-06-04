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

import { schemaRegistry, supportingSchemas, surfaceSchemas } from "./schema-registry.ts";

const outDir = resolve("docs/schemas");
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(schemaRegistry)) {
  const json = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
  });
  const path = resolve(outDir, `${name}.schema.json`);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`  wrote ${path}`);
}

console.log(`\nDone. ${Object.keys(surfaceSchemas).length} surfaces + ${Object.keys(supportingSchemas).length} supporting types.`);
