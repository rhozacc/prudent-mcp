#!/usr/bin/env bun
/**
 * Print a complete human-readable overview of the in-memory corpus.
 *
 *   bun run list
 */
import "../examples/inmemory-demo.ts"; // wires adapters; does NOT start the server
import { adapters } from "../src/adapters.ts";

const HR = "─".repeat(64);
const H1 = (s: string) => `\n${"═".repeat(64)}\n  ${s}\n${"═".repeat(64)}`;
const H2 = (s: string) => `\n${HR}\n  ${s}\n${HR}`;

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

async function main() {
  // ── Corpus info ──────────────────────────────────────────────────────────
  console.log(H1("CORPUS INFO"));
  const info = await adapters.meta.info();
  console.log(fmt(info));

  // ── Review areas ─────────────────────────────────────────────────────────
  console.log(H1("REVIEW AREAS"));
  const areas = await adapters.meta.taxonomy();
  for (const area of areas) {
    const indent = area.parent ? "    " : "  ";
    const tag = area.parent ? `↳ ${area.id}` : area.id;
    console.log(`${indent}${tag}  —  ${area.name}`);
    if (area.children.length) console.log(`${indent}  children: ${area.children.join(", ")}`);
  }

  // ── Regulations ───────────────────────────────────────────────────────────
  console.log(H1("REGULATIONS"));
  const regs = await adapters.regulation.search("");
  for (const r of regs) {
    console.log(H2(`${r.citation}  [${r.id}]`));
    console.log(`  framework: ${r.framework}  |  version: ${r.document_version}`);
    console.log(`\n  ${r.text}`);
    if (r.commentary.length) {
      console.log("\n  commentary:");
      for (const c of r.commentary) {
        console.log(`    [${c.source}]  (${c.last_updated})`);
        console.log(`    ${c.text}`);
      }
    }
    if (r.children.length) console.log(`\n  children: ${r.children.join(", ")}`);
  }

  // ── Tests ─────────────────────────────────────────────────────────────────
  console.log(H1("TESTS"));
  const tests = await adapters.test.search("");
  for (const t of tests) {
    console.log(H2(`${t.name}  [${t.id}]`));
    console.log(`  family: ${t.family}`);
    if (t.parent) console.log(`  parent: ${t.parent}`);
    if (t.aliases.length) console.log(`  aliases: ${t.aliases.join(", ")}`);
    console.log(`\n  purpose: ${t.purpose}`);
    console.log(`\n  acceptance: ${t.acceptance_criteria}`);
  }

  // ── Checks ────────────────────────────────────────────────────────────────
  console.log(H1("CHECKS"));
  const checks = await adapters.check.search("");
  for (const c of checks) {
    console.log(H2(`${c.name}  [${c.id}]`));
    console.log(`  derived_from: ${c.derived_from.join(", ")}`);
    if (c.parent) console.log(`  parent: ${c.parent}`);
    console.log(`\n  expectation: ${c.expectation}`);
    if (c.expected_evidence.length) {
      console.log("\n  evidence:");
      for (const e of c.expected_evidence) console.log(`    • ${e}`);
    }
  }

  // ── Playbooks ─────────────────────────────────────────────────────────────
  console.log(H1("PLAYBOOKS"));
  const playbooks = await adapters.playbook.search("");
  for (const p of playbooks) {
    const label = p.subarea ? `${p.area} / ${p.subarea}` : p.area;
    console.log(H2(`${label}  [${p.id}]`));
    for (const [i, ph] of p.phases.entries()) {
      console.log(`\n  Phase ${i + 1}: ${ph.name}`);
      console.log(`    ${ph.description}`);
      if (ph.references.length) console.log(`    refs: ${ph.references.join(", ")}`);
    }
    if (p.gates.length) {
      console.log("\n  gates:");
      for (const g of p.gates) console.log(`    ✓ ${g}`);
    }
  }

  console.log(`\n${"═".repeat(64)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
