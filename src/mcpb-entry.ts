#!/usr/bin/env node
/**
 * MCPB entry point. Wires up corpus adapters from CORPUS_FILE if set,
 * then starts the server on stdio.
 *
 * Startup integrity gate: the corpus being served must be sound. After the
 * zod parse, the structural linter (validateCorpusFile) runs and any violation
 * aborts startup with exit 1 — serving a corpus with dangling references or a
 * broken mirror invariant would make every traversal tool quietly wrong.
 * Registry warnings (corpusWarnings — stale sources, coverage declared for nothing) go to stderr but never
 * block: a stale source needs a /maintain-context run, not a dead server.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ZodError } from "zod";

import { adapters } from "./adapters.ts";
import { createFileAdapters, loadCorpusFile } from "./file-adapter.ts";
import { createServer } from "./server.ts";
import { corpusWarnings, validateCorpusFile } from "./validate.ts";

const corpusFile = process.env["CORPUS_FILE"];

if (corpusFile) {
  try {
    const corpus = loadCorpusFile(corpusFile);

    const violations = validateCorpusFile(corpus);
    if (violations.length > 0) {
      console.error(`prudent-mcp: corpus file "${corpusFile}" fails ${violations.length} integrity check(s):`);
      for (const v of violations) console.error(`  ✗ ${v}`);
      console.error("prudent-mcp: refusing to serve an unsound corpus. Fix the violations (bun run validate) and restart.");
      process.exit(1);
    }
    for (const w of corpusWarnings(corpus)) {
      console.error(`prudent-mcp: ⚠ ${w} — run /maintain-context to review the registry.`);
    }

    const fa = createFileAdapters(corpus);
    adapters.regulation = fa.regulation;
    adapters.test = fa.test;
    adapters.check = fa.check;
    adapters.playbook = fa.playbook;
    adapters.source = fa.source;
    adapters.meta = fa.meta;
  } catch (err) {
    if (err instanceof ZodError) {
      console.error(`prudent-mcp: corpus file "${corpusFile}" does not match the corpus schema:`);
      for (const issue of err.issues) {
        console.error(`  ✗ ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
      }
    } else {
      console.error(`prudent-mcp: failed to load corpus file "${corpusFile}":`, err);
    }
    process.exit(1);
  }
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
