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

  // ── Regulations ───────────────────────────────────────────────────────────
  console.log(H1("REGULATIONS"));
  const regs = await adapters.regulation.list();
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
  const tests = await adapters.test.list();
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
  const checks = await adapters.check.list();
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
  const playbooks = await adapters.playbook.list();
  for (const p of playbooks) {
    console.log(H2(`${p.title}  [${p.id}]  (${p.area}, ${p.provenance.status})`));
    console.log(`  ${p.summary}`);
    for (const r of p.requirements) {
      console.log(`\n  ${r.id}. ${r.title}`);
      console.log(`    cites: ${r.provisions.map((x) => x.id).join(", ")}`);
    }
    if (p.pitfalls.length) {
      console.log("\n  pitfalls:");
      for (const x of p.pitfalls) console.log(`    ! ${x.text}`);
    }
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  console.log(H1("SOURCES"));
  const sources = await adapters.source.list();
  for (const s of sources) {
    console.log(H2(`${s.title}  [${s.id}]`));
    console.log(`  ${s.doc_type}  |  status: ${s.status}  |  verified: ${s.verified}`);
    console.log(`  document_id: ${s.document_id}`);
    if (s.superseded_by) console.log(`  superseded_by: ${s.superseded_by}`);
    if (s.milestones.length) {
      console.log("\n  milestones:");
      for (const m of s.milestones) console.log(`    ${m.date}  —  ${m.event}`);
    }
    if (s.notes) console.log(`\n  ${s.notes}`);
  }

  console.log(`\n${"═".repeat(64)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
