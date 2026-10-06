import { describe, expect, it } from "bun:test";

import { serverLanguageIsClean } from "../evals/invariants.ts";
import type { CallTrace, Session, ToolCard } from "../evals/harness.ts";

// I17 on stand-in servers: one that says what it should, and servers that leak
// their plumbing in each of the places the invariant looks.

const trace = (tool: string, json: unknown, isError = false, text?: string): CallTrace => {
  const body = text ?? JSON.stringify(json);
  return { tool, args: {}, text: body, chars: body.length, tokens: 0, ms: 0, isError, json: isError ? null : json };
};

const card = (name: string, description: string, schema: unknown = {}, output?: unknown): ToolCard => ({
  name,
  description,
  schemaText: JSON.stringify(schema),
  schemaChars: 0,
  tokens: 0,
  ...(output === undefined ? {} : { outputSchema: output }),
});

function session(over: { instructions?: string; tools?: ToolCard[]; traces?: CallTrace[] }): Session {
  return {
    tools: over.tools ?? [card("get_thing", "Fetch one provision by id.")],
    surfaceTokens: 0,
    wireTokens: 0,
    instructions: over.instructions ?? "A library of provisions. Start with get_corpus_info.",
    traces: over.traces ?? [],
    async call() {
      throw new Error("not used");
    },
    async close() {},
  } as Session;
}

const fatal = async (s: Session) => (await serverLanguageIsClean(s)).findings.filter((f) => f.severity === "fatal");

describe("eval I17", () => {
  it("passes a server that speaks in the library's own words", async () => {
    const r = await serverLanguageIsClean(
      session({
        traces: [
          trace("get_regulation", {
            text: "The corpus is mentioned in the provision's own text, which is data.",
            pending_changes_note: "Amending act applies from 2026-10-19; the text below is the version before it.",
          }),
          trace("get_regulation", null, true, "No provision has the id regulation://x/1. Verify the id with search_regulation."),
        ],
      }),
    );
    expect(r.applicable).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("fails plumbing words in the instructions", async () => {
    const f = await fatal(session({ instructions: "Everything here is served from the corpus." }));
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("I17/instructions");
    expect(f[0]!.summary).toContain('"served"');
    expect(f[0]!.summary).toContain('"corpus"');
  });

  it("fails plumbing words in a tool description, an input field and an output field", async () => {
    const f = await fatal(
      session({
        tools: [
          card(
            "get_thing",
            "Fetch one record by id.",
            { properties: { id: { type: "string", description: "An id from the registry." } } },
            { properties: { note: { type: "string", description: "Said by the adapter." } } },
          ),
        ],
      }),
    );
    expect(f.map((x) => x.id).sort()).toEqual(["I17/get_thing description", "I17/get_thing input field", "I17/get_thing output field"]);
  });

  it("lets a description name tools and fields", async () => {
    expect(
      await fatal(session({ tools: [card("get_thing", "Use get_corpus_info.holdings or search_regulation; `records` counts them.")] })),
    ).toEqual([]);
  });

  it("fails plumbing words in a note or notice a model repeats to a user", async () => {
    const f = await fatal(
      session({
        traces: [
          trace("search_regulation", { results: [], notice: "The topic may not be in this corpus." }),
          trace("get_regulation", { pending_changes_note: "A change is not ingested here." }),
          trace("resolve_citation", { match: null, coverage_note: "No record matches." }),
        ],
      }),
    );
    expect(f.map((x) => x.id).sort()).toEqual([
      "I17/get_regulation pending_changes_note",
      "I17/resolve_citation coverage_note",
      "I17/search_regulation notice",
    ]);
  });

  it("fails an identifier in a note, which must be repeatable to a user as written", async () => {
    const f = await fatal(session({ traces: [trace("search_checks", { results: [], notice: "Call get_source for details." })] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.summary).toContain("the identifier get_source");
  });

  it("finds a note nested anywhere in a reply, but never reads record text", async () => {
    const f = await fatal(
      session({
        traces: [
          trace("get_regulation_tree", { tree: { children: [{ as_of_note: "Shown from the corpus." }] } }),
          trace("get_source", { notes: "Registry notes written by the maintainer.", note: "The corpus record." }),
        ],
      }),
    );
    expect(f.map((x) => x.id)).toEqual(["I17/get_regulation_tree as_of_note"]);
  });

  it("scans a miss for plumbing words but lets it name the tool to call next", async () => {
    expect(
      await fatal(session({ traces: [trace("get_check", null, true, "No check has the id check://x. Verify the id with search_checks.")] })),
    ).toEqual([]);
    const f = await fatal(session({ traces: [trace("get_check", null, true, "No record for check://x.")] }));
    expect(f.map((x) => x.id)).toEqual(["I17/get_check miss"]);
  });

  it("ignores the protocol's own rejection wording", async () => {
    expect(
      await fatal(session({ traces: [trace("get_check", null, true, "MCP error -32602: Input validation error: record is required")] })),
    ).toEqual([]);
  });

  it("says each distinct leak once", async () => {
    const same = trace("search_tests", { results: [], notice: "Not in this corpus." });
    expect(await fatal(session({ traces: [same, same, same] }))).toHaveLength(1);
  });

  it("is not applicable when there is nothing to read", async () => {
    const r = await serverLanguageIsClean(session({ instructions: "", tools: [] }));
    expect(r.applicable).toBe(false);
  });
});
