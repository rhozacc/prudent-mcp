import { describe, expect, it } from "bun:test";

import { corpusInfoFrom, envelopeFrom, isLegacyTool, legacyCall, provisionFrom, resolutionFrom, sourceListFrom } from "../evals/legacy.ts";
import type { CallTrace } from "../evals/harness.ts";

// The translation must not invent: every field it reads back is derived from something the 1.0 tool sent.

describe("evals/legacy: 1.0 replies read back in the 0.x shape", () => {
  it("get → the record, with the version, amendment and placeholder notes as the fields they replaced", () => {
    const j = {
      notes: [
        { type: "version", text: "no version for the date" },
        { type: "amendment", text: "replaced from 2027" },
        { type: "placeholder", text: "a placeholder is not a citation" },
      ],
      records: [{ id: "regulation://a/1", text: "See Regulation (EU) xx/xx [RTS on a topic]." }],
    };
    const out = provisionFrom(j);
    expect(out["as_of_note"]).toBe("no version for the date");
    expect(out["pending_changes_note"]).toBe("replaced from 2027");
    expect(out["pre_adoption_placeholders"]).toEqual(["Regulation (EU) xx/xx [RTS on a topic]"]);
    expect(out["id"]).toBe("regulation://a/1");
    expect(provisionFrom({ records: [{ id: "x", text: "plain" }] })).toEqual({ id: "x", text: "plain" });
  });

  it("a placeholder note on text that names none invents no flag", () => {
    expect("pre_adoption_placeholders" in provisionFrom({ notes: [{ type: "placeholder", text: "x" }], records: [{ id: "x", text: "plain" }] })).toBe(false);
  });

  it("cite → the resolution with coverage_note and pending_changes_note from its notes", () => {
    const out = resolutionFrom({ match: null, confidence: "none", notes: [{ type: "outside_library", text: "not held" }, { type: "amendment", text: "amended" }] });
    expect(out).toMatchObject({ coverage_note: "not held", pending_changes_note: "amended", match: null });
    expect("notes" in out).toBe(false);
  });

  it("search → the envelope whose notice carries truncation, weak match and amendment sentences in that order", () => {
    const out = envelopeFrom({ results: [], notice: "Showing 1 of 3.", notes: [{ type: "amendment", text: "A." }, { type: "weak_match", text: "W." }] });
    expect(out["notice"]).toBe("Showing 1 of 3. W. A.");
    expect("notes" in out).toBe(false);
    expect("notice" in envelopeFrom({ results: [] })).toBe(false);
  });

  it("sources → corpus info (holdings, coverage) and the source list", () => {
    const j = { documents: [{ id: "source://a/b", title: "T", document_id: "b", framework: "a", status: "current", held: "part", provisions: 4, verified: "2026-01-01", open_changes: 1 }, { id: "source://a/c", title: "U", document_id: "c", framework: "a", status: "current", held: "undeclared", verified: "2026-01-01" }], counts: { regulation: 4 }, changes: [{ title: "x" }], overdue_for_check: ["source://a/b"] };
    const info = corpusInfoFrom(j);
    expect(info["holdings"]).toEqual([
      { document_id: "b", framework: "a", title: "T", records: 4, partial: true },
      { document_id: "c", framework: "a", title: "U", records: 0 },
    ]);
    expect(info["coverage"]).toEqual(["B", "C"]);
    expect(info["pending_changes"]).toEqual([{ title: "x" }]);
    expect(info["stale_sources"]).toEqual(["source://a/b"]);
    expect((sourceListFrom(j)["sources"] as Array<Record<string, unknown>>)[0]).toMatchObject({ id: "source://a/b", open_pending_changes: 1 });
  });

  it("a tool 1.0 removed is an error, so an invariant that still needs it fails instead of binding on nothing", async () => {
    const t = await legacyCall(async () => { throw new Error("must not call"); }, "get_area_overview", {});
    expect(t.isError).toBe(true);
    expect(isLegacyTool("get_area_overview")).toBe(true);
    expect(isLegacyTool("brief")).toBe(false);
  });

  it("makes the call on the real tool and reads the real reply back", async () => {
    const seen: Array<[string, Record<string, unknown>]> = [];
    const raw = async (tool: string, args: Record<string, unknown>): Promise<CallTrace> => {
      seen.push([tool, args]);
      return { tool, args, text: "{}", chars: 2, tokens: 1, ms: 1, isError: false, json: { records: [{ id: "regulation://a/1", text: "t" }] } };
    };
    const t = await legacyCall(raw, "get_regulation", { id: "regulation://a/1", as_of: "2020-01-01" });
    expect(seen).toEqual([["get", { ids: "regulation://a/1", as_of: "2020-01-01" }]]);
    expect((t.json as Record<string, unknown>)["id"]).toBe("regulation://a/1");
    expect(t.tool).toBe("get_regulation");
  });
});
