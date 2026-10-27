import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/server.ts";

/**
 * The docs describe the surface `createServer()` registers, and only that one. A tool added without a docs entry,
 * or a 0.x tool name left in a page that says how to use the server, sends a reader (and the model they paste it
 * to) to a tool that is not there. The history of the 0.x names lives in docs/design/ and CHANGES.md, which are
 * the only places allowed to say them.
 */
const RETIRED = [
  "get_regulation", "search_regulation", "search_checks", "search_tests", "search_playbooks", "get_check", "get_test",
  "get_playbook", "resolve_citation", "get_corpus_info", "list_sources", "get_source", "get_referrers",
  "list_review_areas", "expand_playbook", "get_area_overview", "expand_regulation", "get_regulation_tree",
  "get_coverage_gaps",
];

const ROOT = join(import.meta.dir, "..");
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name === "cache" || name === "dist") continue;
    const rel = join(dir, name);
    if (rel === join("docs", "design")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...textFiles(rel));
    else if (/\.(md|json|ts|vue|mts)$/.test(name)) out.push(rel);
  }
  return out;
}

async function registeredTools(): Promise<string[]> {
  const server = createServer();
  const client = new Client({ name: "docs-surface-test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

describe("docs name the tools the server registers", () => {
  test("every registered tool is on docs/tools/index.md and in README.md", async () => {
    const tools = await registeredTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const page of ["docs/tools/index.md", "README.md"]) {
      const text = read(page);
      for (const tool of tools) expect(text, `${page} names \`${tool}\``).toMatch(new RegExp(`\`${tool}\``));
    }
  });

  test("no retired 0.x tool name appears outside docs/design/ and CHANGES.md", () => {
    const files = ["README.md", "evals/README.md", ...textFiles("docs")];
    const found: string[] = [];
    for (const file of files) {
      const text = read(file);
      for (const name of RETIRED) if (new RegExp(`\\b${name}\\b`).test(text)) found.push(`${relative(".", file)}: ${name}`);
    }
    expect(found).toEqual([]);
  });
});
