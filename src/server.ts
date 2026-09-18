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
        "IRB credit-risk regulatory knowledge layer — read-only; the server describes, computation happens elsewhere.\n" +
        "Five surfaces with matching URI schemes: regulation:// test:// check:// playbook:// source://.\n" +
        "Entry path: get_corpus_info → list_review_areas → get_area_overview(area) for the one-shot bundle of a review area.\n" +
        "Traversal: expand_playbook / expand_regulation (references resolved inline), get_regulation_tree (dossier walk, " +
        "200-node cap), get_referrers (the reverse index), get_coverage_gaps (its aggregate inverse).\n" +
        "Conventions: search_* and traversal tools are concise by default — pass detail: 'full' for complete records; " +
        "search_* return { results, returned, total_matches, offset, truncated, next_offset, notice }. total_matches " +
        "is the whole match set, not the page: page with next_offset until it is null before concluding anything is " +
        "absent. Responses are size-capped — a shortened page or a summary served in place of detail: 'full' says so " +
        "in `notice`, and nothing is ever dropped silently.\n" +
        "Concise search results carry a quotable excerpt (whole sentences around the match); quote it rather than " +
        "re-fetching the record to confirm a hit.\n" +
        "Misses come back as isError results pointing at the right search/list tool — never a bare 'null'.\n" +
        "Regulation is the only versioned surface: pass as_of (ISO date) for the text in force on that date; backends " +
        "without history serve current text, and an as_of predating all recorded versions is a miss.\n" +
        "resolve_citation declines rather than guesses: a citation naming an instrument or provision this corpus does " +
        "not hold comes back with match null plus candidates and a coverage_note. A null match is not a citation — " +
        "never present one as though the text were found.\n" +
        "Sources are the currency registry (verified dates, supersession, milestones); they join regulation via " +
        "framework + document_id, never by URI reference.\n" +
        // The three rules below are about the EDGE of the corpus, and they exist
        // because a grounded answer once lost to an ungrounded one on exactly
        // this: the server was authoritative about what it held and silent
        // about everything else, so the model treated the corpus boundary as
        // the boundary of the subject and filled the rest in from memory,
        // unlabelled and wrong.
        //
        // They are RULES, not facts. This repo is public and corpus-agnostic;
        // every fact a caller needs comes from get_corpus_info, list_sources
        // and the records themselves at runtime.
        "Scope: this is a BOUNDED corpus, not the regulatory universe — get_corpus_info names every document " +
        "loaded. Absence from it is not absence from the law, and a miss from this server is a statement about " +
        "this corpus only. get_coverage_gaps measures coverage of provisions BY checks and tests INSIDE the " +
        "corpus; it does not measure coverage of the law by the corpus.\n" +
        "Answering past the boundary: a real question often turns on an instrument this corpus does not hold. " +
        "Search first — total_matches and next_offset tell you whether you actually looked. Then neither truncate " +
        "the answer at the corpus boundary nor blend across it: give what the question needs and LABEL it, " +
        "marking any statement not traceable to a record id as not corpus-backed and naming what it rests on. " +
        "Where a record's own text defers to an instrument this corpus lacks — including a pre-adoption " +
        "placeholder of the form 'Regulation (EU) xx/xx [...]' — say the reference is unresolved here, and never " +
        "present the placeholder as the current state of the law.\n" +
        "Legal force and drafting register are DIFFERENT AXES. `obligation` (must/should/may) is how ONE provision " +
        "is worded; it says nothing about what the document IS, and `doc_type` is a format label that carries no " +
        "tier. Never infer binding force from either: a supervisory guide that is not a legal act can carry " +
        "hundreds of `must` provisions. Resolve force from the empowering provision's served text instead — an " +
        "article delegating power to adopt regulatory technical standards creates a delegated act, one directing " +
        "an authority to issue guidelines under Article 16 of Regulation (EU) No 1093/2010 creates comply-or-" +
        "explain guidance — and a provision RESTATING a higher instrument carries that instrument's force, not " +
        "its host document's. A tier claim you cannot quote from a record is not corpus-backed.\n" +
        // Guidance, not enforcement: instructions are advisory and no string here can
        // compel a client model to leave a quote alone. The machine-checked half of
        // this promise is the verbatim invariant in src/validate.ts, which keeps
        // markup out of the records the client is asked to reproduce.
        "Presentation: reproduce record text — regulation, citations, commentary, expectations — verbatim as plain " +
        "text; never add HTML, markdown emphasis or markup the record does not contain, and keep notation exactly " +
        "as the source spells it (LGD in-default, not LGD with a subscript).",
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
