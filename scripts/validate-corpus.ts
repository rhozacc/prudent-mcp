#!/usr/bin/env bun
/**
 * Corpus integrity linter — the machine-checked version of the invariants the
 * docs describe as conventions. CI-able: exits non-zero on any violation.
 *
 *   bun run validate                       # validates the in-memory demo corpus
 *   CORPUS_FILE=corpus.json bun run validate
 *
 * The invariant logic lives in src/validate.ts so other callers (e.g. the
 * dashboard that produces the corpus) can run the same checks without going
 * through this CLI.
 */
import { adapters } from "../src/adapters.ts";
import { computeHoldings, holdingsSummary } from "../src/holdings.ts";
import { corpusInfo, corpusWarnings, validateCorpus } from "../src/validate.ts";

async function wireCorpus(): Promise<void> {
  const corpusFile = process.env.CORPUS_FILE;
  if (corpusFile) {
    const { createFileAdapters, loadCorpusFile } = await import("../src/file-adapter.ts");
    Object.assign(adapters, createFileAdapters(loadCorpusFile(corpusFile)));
  } else {
    await import("../examples/inmemory-demo.ts"); // side-effect wires the demo adapters
  }
}

async function main(): Promise<void> {
  await wireCorpus();

  const [regs, checks, tests, playbooks, sources] = await Promise.all([
    adapters.regulation.list(),
    adapters.check.list(),
    adapters.test.list(),
    adapters.playbook.list(),
    adapters.source.list(),
  ]);

  const corpus = { regulation: regs, tests, checks, playbooks, sources };
  const errors = validateCorpus(corpus);
  const warnings = corpusWarnings(corpus);

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} corpus integrity issue(s):\n`);
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }

  // Warnings are advisory — stale currency or a coverage declaration about nothing needs a maintenance run
  // (/maintain-context), not a failed build.
  if (warnings.length > 0) {
    console.error(`⚠ ${warnings.length} corpus warning(s):\n`);
    for (const w of warnings) console.error(`  • ${w}`);
    console.error("");
  }

  // Information only: counted, never a failure and never a warning.
  for (const line of corpusInfo(corpus)) console.log(`  info: ${line}`);
  console.log(`  holdings: ${holdingsSummary(computeHoldings(regs, sources)) || "none"}`);
  console.log(
    `✓ corpus integrity OK — ${regs.length} regulations, ${checks.length} checks, ` +
      `${tests.length} tests, ${playbooks.length} playbooks, ${sources.length} sources`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
