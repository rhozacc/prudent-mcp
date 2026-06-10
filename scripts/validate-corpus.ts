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
import { validateCorpus } from "../src/validate.ts";

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

  const [regs, checks, tests, playbooks] = await Promise.all([
    adapters.regulation.search(""),
    adapters.check.search(""),
    adapters.test.search(""),
    adapters.playbook.search(""),
  ]);

  const errors = validateCorpus({ regulation: regs, tests, checks, playbooks });

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} corpus integrity issue(s):\n`);
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(1);
  }

  console.log(
    `✓ corpus integrity OK — ${regs.length} regulations, ${checks.length} checks, ` +
      `${tests.length} tests, ${playbooks.length} playbooks`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
