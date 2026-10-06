import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { bannedTermsIn } from "../src/language.ts";
import { createServer } from "../src/server.ts";

/**
 * The instructions block is the only place the edge-of-the-corpus RULES are
 * stated once for the whole surface (the tool cards say what a field is, not
 * what a caller may conclude from it). They are advisory strings, so what can be
 * pinned is that each rule is still PRESENT and that none of them names a
 * document: this repo is public and corpus-agnostic.
 */
async function instructions(): Promise<string> {
  const server = createServer();
  const client = new Client({ name: "instructions-test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const text = client.getInstructions() ?? "";
  await client.close();
  return text;
}

describe("server instructions", () => {
  test("carry one rule each for the edge behaviours the tools can signal", async () => {
    const text = await instructions();
    for (const key of [
      "as_of_note", // current text under as_of is not the text of that date
      "holdings", // a miss on a partly held document is absent from the corpus
      "best_coverage", // read it before treating the top of a list as an answer
      "query_tokens",
      "pre_adoption_placeholders", // a placeholder is not a citation
      "pending_changes_note", // a change the corpus has not ingested: the served text is the version before it
    ]) {
      expect(text).toContain(key);
    }
  });

  test("name the search envelope fields a caller pages and judges by, and the search tools carry the envelope", async () => {
    const text = await instructions();
    for (const key of ["total_matches", "next_offset", "best_coverage", "query_tokens"]) expect(text).toContain(key);
    const server = createServer();
    const client = new Client({ name: "instructions-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    await client.close();
    // The exact envelope lives on the tool that returns it, once, not in the instructions.
    const search = tools.find((t) => t.name === "search_regulation");
    expect(search?.description ?? "").toContain("{ results, returned, total_matches, offset, truncated, next_offset, notice }");
  });

  test("stay within the interim budget of 500 tokens", async () => {
    // estimateTokens is chars / 4. The 1.0 target is 350; 0.10 was about 1,300.
    expect(Math.round((await instructions()).length / 4)).toBeLessThanOrEqual(500);
  });

  test("keep to the library's own words (the language rule)", async () => {
    expect(bannedTermsIn(await instructions())).toEqual([]);
  });

  test("state each rule once: no tool card repeats the search-coverage sentence", async () => {
    const server = createServer();
    const client = new Client({ name: "instructions-test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    await client.close();
    for (const t of tools.filter((x) => x.name.startsWith("search_"))) {
      expect(t.description ?? "").not.toContain("best_coverage");
    }
  });
});
