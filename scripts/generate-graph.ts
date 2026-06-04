#!/usr/bin/env bun
/**
 * Generate a Mermaid map of the corpus and write it to docs/corpus/graph.md.
 *
 *   bun run graph                          # graphs the in-memory demo corpus
 *   CORPUS_FILE=corpus.json bun run graph
 *
 * The diagram can't drift from the data because it's derived from it. Node
 * shapes encode the surface (theme-independent, unlike colour):
 *   regulation [rect]   check (rounded)   test {{hexagon}}   playbook [[subroutine]]
 * Solid arrows are Regulation.children; dotted arrows are playbook phase
 * references.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { adapters } from "../src/adapters.ts";

const nodeId = (uri: string): string => uri.replace(/[^a-zA-Z0-9]/g, "_");
const label = (s: string): string => s.replace(/"/g, "'");

async function wireCorpus(): Promise<void> {
  const corpusFile = process.env.CORPUS_FILE;
  if (corpusFile) {
    const { createFileAdapters, loadCorpusFile } = await import("../src/file-adapter.ts");
    Object.assign(adapters, createFileAdapters(loadCorpusFile(corpusFile)));
  } else {
    await import("../examples/inmemory-demo.ts");
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

  const lines: string[] = ["flowchart LR"];

  // Group nodes into a subgraph per surface so the map reads as clusters rather
  // than a hairball. Shapes still encode the surface for when edges cross groups.
  const subgraph = (title: string, nodes: string[]): void => {
    if (nodes.length === 0) return;
    lines.push(`  subgraph ${title}`, ...nodes, "  end");
  };
  subgraph("Regulation", regs.map((r) => `    ${nodeId(r.id)}["${label(r.citation)}"]`));
  subgraph("Check", checks.map((c) => `    ${nodeId(c.id)}("${label(c.name)}")`));
  subgraph("Test", tests.map((t) => `    ${nodeId(t.id)}{{"${label(t.name)}"}}`));
  subgraph(
    "Playbook",
    playbooks.map((p) => `    ${nodeId(p.id)}[["${label(p.subarea ? `${p.area}/${p.subarea}` : p.area)}"]]`),
  );

  // Edges, deduplicated (a playbook may reference the same record in two phases).
  const edges = new Set<string>();
  // Solid: Regulation.children (structure + operationalization).
  for (const r of regs) for (const child of r.children) edges.add(`  ${nodeId(r.id)} --> ${nodeId(child)}`);
  // Dotted: playbook phase references reaching across surfaces.
  for (const p of playbooks) {
    for (const ph of p.phases) {
      for (const ref of ph.references) edges.add(`  ${nodeId(p.id)} -.-> ${nodeId(ref)}`);
    }
  }
  lines.push(...edges);

  const md = `---
title: Corpus graph
---

# Corpus graph

> **Auto-generated** by \`bun run graph\` from the bundled demo corpus — do not edit by hand. Regenerate whenever corpus data changes.

A map of how the loaded records reference each other. Node shapes encode the surface, so it reads the same in light and dark themes:

- **Regulation** — rectangle
- **Check** — rounded
- **Test** — hexagon
- **Playbook** — subroutine box

Solid arrows are \`Regulation.children\` (sub-regulations plus the checks/tests that operationalize a record). Dotted arrows are playbook phase references reaching across surfaces.

\`\`\`mermaid
${lines.join("\n")}
\`\`\`
`;

  const out = resolve("docs/corpus/graph.md");
  writeFileSync(out, md);
  console.log(
    `wrote ${out} — ${regs.length} regulations, ${checks.length} checks, ` +
      `${tests.length} tests, ${playbooks.length} playbooks`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
