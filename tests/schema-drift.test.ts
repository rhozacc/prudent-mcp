import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";

import { schemaRegistry } from "../scripts/schema-registry.ts";

// Golden test: the committed docs/schemas/*.json must equal what the live zod
// definitions produce. Catches the easy mistake of editing a schema and
// forgetting `bun run schemas`. Output must be byte-identical to
// scripts/generate-schemas.ts (same options, same JSON.stringify + trailing \n).
describe("JSON Schema drift", () => {
  for (const [name, schema] of Object.entries(schemaRegistry)) {
    it(`docs/schemas/${name}.schema.json is up to date`, () => {
      const expected =
        JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: "none" }), null, 2) + "\n";
      const committed = readFileSync(resolve("docs/schemas", `${name}.schema.json`), "utf8");
      expect(committed, `run 'bun run schemas' to regenerate ${name}.schema.json`).toBe(expected);
    });
  }
});
