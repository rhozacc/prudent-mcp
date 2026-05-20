#!/usr/bin/env node
/**
 * MCPB entry point. Wires up corpus adapters from CORPUS_FILE if set,
 * then starts the server on stdio.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { adapters } from "./adapters.ts";
import { createFileAdapters, loadCorpusFile } from "./file-adapter.ts";
import { createServer } from "./server.ts";

const corpusFile = process.env["CORPUS_FILE"];

if (corpusFile) {
  try {
    const corpus = loadCorpusFile(corpusFile);
    const fa = createFileAdapters(corpus);
    adapters.regulation = fa.regulation;
    adapters.test = fa.test;
    adapters.check = fa.check;
    adapters.playbook = fa.playbook;
    adapters.meta = fa.meta;
  } catch (err) {
    console.error(`prudent-mcp: failed to load corpus file "${corpusFile}":`, err);
    process.exit(1);
  }
}

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
