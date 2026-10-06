#!/usr/bin/env node
/**
 * Prudent-MCP server entry point.
 *
 * Registration is explicit (no decorator side effects) — read this file and
 * you can see exactly what surface area exists.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import packageJson from "../package.json";
import { registerMetaTools } from "./tools/meta.ts";
import { registerRegulationTools } from "./tools/regulation.ts";
import { registerTestTools } from "./tools/tests.ts";
import { registerCheckTools } from "./tools/checks.ts";
import { registerPlaybookTools } from "./tools/playbooks.ts";
import { registerSourceTools } from "./tools/sources.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts/validateReviewArea.ts";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "prudent-mcp",
      // Single-sourced from package.json — the two drifted before.
      version: packageJson.version,
    },
    {
      instructions:
        // Not "for validators": the surface is the same whether the caller is an
        // analyst, a validator, a supervisor, a developer or an auditor. Naming
        // one of them narrows what a model believes it may be asked.
        //
        // Written in the library's own words (src/language.ts, eval I17): a model
        // repeats what it is told to the person it answers, and "the corpus has
        // this" is a description of a tool, not of regulation. Tool and field
        // names are the one exception, since they have to be named.
        //
        // The rules about the EDGE of the library are here and are RULES, not
        // facts: a grounded answer once lost to an ungrounded one because the
        // server was authoritative about what it held and silent about everything
        // else, so the model took the boundary of the library for the boundary of
        // the subject and filled the rest in from memory, unlabelled and wrong.
        // This repo is public; every fact a caller needs comes from
        // get_corpus_info, list_sources and the entries themselves at runtime.
        "IRB credit-risk regulation and supervisory practice (CRR, EBA guidelines, ECB guide to internal " +
        "models) as a library of provisions, checks, tests, playbooks and sources. Read-only.\n" +
        "Start with get_corpus_info, then list_review_areas and get_area_overview for a whole area, or the " +
        "search_* tools for a specific question. get_* and resolve_citation open one entry; get_referrers, " +
        "expand_* and get_regulation_tree walk its neighbours.\n" +
        "Search ranks, it does not filter: total_matches counts every match, so page with next_offset until it is " +
        "null before concluding anything is absent. Read best_coverage (and a row's `coverage`, out of query_tokens) before treating the top of a " +
        "list as an answer; when it is low, do not answer from the nearest hit. Quote the excerpt instead of " +
        "re-opening an entry.\n" +
        "The library holds part of the regulatory universe (`holdings` says whole, part or undeclared per " +
        "document): not finding something is not evidence it is not in the law. Say what the library holds; " +
        "label anything added from elsewhere. Where a provision refers to an instrument the library lacks, " +
        "including a pre-adoption placeholder like \"Regulation (EU) xx/xx\" (pre_adoption_placeholders), say " +
        "the reference is unresolved; never replace a placeholder with a numbered act from memory. " +
        "resolve_citation declines rather than guesses: a null match is not a citation.\n" +
        "as_of gives the text in force on a date; where the library has no version, the current text comes back " +
        "with an as_of_note and is not evidence of what applied then. A pending_changes_note means a change " +
        "applies, or will, that the text does not yet include: say so, with the date.\n" +
        // Guidance, not enforcement: instructions are advisory and no string here can
        // compel a client model to leave a quote alone. The machine-checked half of
        // this promise is the verbatim invariant in src/validate.ts, which keeps
        // markup out of the entries the client is asked to reproduce.
        "Force and drafting register differ: `obligation` (must/should/may) is how a provision is worded and " +
        "doc_type is a format label; infer binding force from neither, take it from the empowering " +
        "provision. A supervisory guide can carry hundreds of `must`s.\n" +
        "Cite by citation (\"EBA/GL/2017/16 para 28\"), not id; quote provision text verbatim " +
        "in the source's notation.",
    },
  );

  registerMetaTools(server);
  registerRegulationTools(server);
  registerTestTools(server);
  registerCheckTools(server);
  registerPlaybookTools(server);
  registerSourceTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

export const server = createServer();

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if invoked directly (not when imported by examples or tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("prudent-mcp failed to start:", err);
    process.exit(1);
  });
}
