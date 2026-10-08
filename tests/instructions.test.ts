import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { bannedTermsIn } from "../src/language.ts";
import { createServer } from "../src/server.ts";

/**
 * The instructions block says how to start and how to answer; the rules about the EDGE of the library (an amendment, a
 * version, an instrument not held, a placeholder, a weak match) travel as notes on the response they concern. What can be
 * pinned is that the entry path and the answering rules are present, that the block stays small, that it keeps to the
 * library's own words, and that it names no document: this repo is public and corpus-agnostic.
 */
async function session() {
  const server = createServer();
  const client = new Client({ name: "instructions-test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const text = client.getInstructions() ?? "";
  const { tools } = await client.listTools();
  await client.close();
  return { text, tools };
}

describe("server instructions", () => {
  test("send a substantive question to brief first, and name every other tool once", async () => {
    const { text, tools } = await session();
    expect(text).toMatch(/call brief first/);
    for (const t of tools) expect(text, t.name).toContain(t.name);
  });

  test("tell the model to cite officially, keep sources apart and repeat the notes", async () => {
    const { text } = await session();
    expect(text).toMatch(/official citation/);
    expect(text).toMatch(/never by internal identifiers/);
    expect(text).toMatch(/law, EBA guidelines, ECB supervisory expectations and market practice/);
    expect(text).toMatch(/Repeat each note/);
    expect(text).toMatch(/instrument the library does not hold/);
  });

  test("do not carry the 0.x edge-of-corpus rules: each is a note now", async () => {
    const { text } = await session();
    for (const gone of ["as_of_note", "holdings", "best_coverage", "pre_adoption_placeholders", "pending_changes_note", "total_matches"]) {
      expect(text).not.toContain(gone);
    }
  });

  test("the search envelope lives on the tool that returns it, once", async () => {
    const { tools } = await session();
    const search = tools.find((t) => t.name === "search");
    expect(search?.description ?? "").toContain("total_matches");
    expect(search?.description ?? "").toContain("best_coverage");
    for (const t of tools.filter((x) => x.name !== "search")) expect(t.description ?? "").not.toContain("best_coverage");
  });

  test("stay within the 1.0 budget of 350 tokens", async () => {
    // estimateTokens is chars / 4; 0.10 was about 1,300.
    expect(Math.round((await session()).text.length / 4)).toBeLessThanOrEqual(350);
  });

  test("keep to the library's own words (the language rule)", async () => {
    expect(bannedTermsIn((await session()).text)).toEqual([]);
  });
});
