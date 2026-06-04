#!/usr/bin/env bun
/**
 * Generate a human-browsable schema reference page at docs/corpus/schemas.md
 * from the same zod definitions the server validates against.
 *
 * Companion to the prose field tables in docs/corpus/index.md: that page is the
 * "why", this one is the exact machine contract, each schema collapsible and
 * syntax-highlighted. Chained off `bun run schemas` so the two never drift.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";

import { supportingSchemas, surfaceSchemas } from "./schema-registry.ts";

type SchemaMap = Record<string, Parameters<typeof zodToJsonSchema>[0]>;

function render(group: SchemaMap): string {
  return Object.entries(group)
    .map(([name, schema]) => {
      const json = JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: "none" }), null, 2);
      return `<details>\n<summary><code>${name}</code></summary>\n\n\`\`\`json\n${json}\n\`\`\`\n\n</details>`;
    })
    .join("\n\n");
}

const md = `---
title: Schema reference
---

# Schema reference

> **Auto-generated** by \`bun run schema-docs\` from \`src/schema.ts\` — do not edit by hand. For the reasoning behind each field, read [Corpus structure](/corpus/). The same definitions are emitted as standalone files under \`docs/schemas/*.schema.json\` for adapter build pipelines.

Each block is the JSON Schema (draft-07) for one corpus type. Expand to read the field-level contract.

## Surfaces

${render(surfaceSchemas)}

## Supporting types

${render(supportingSchemas)}
`;

const out = resolve("docs/corpus/schemas.md");
writeFileSync(out, md);
console.log(
  `wrote ${out} — ${Object.keys(surfaceSchemas).length} surfaces + ${Object.keys(supportingSchemas).length} supporting types`,
);
