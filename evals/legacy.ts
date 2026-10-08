/**
 * The 0.x probe vocabulary, answered by the 1.0 tools.
 *
 * The invariants were written against nineteen tools and their reply shapes (`get_regulation` with an `as_of_note`,
 * `resolve_citation` with a `coverage_note`, `get_corpus_info` with `holdings`). The properties they check did not change
 * with the surface: a miss must say what the library holds, an amended provision must say so, a weak match must be declared.
 * So each probe is made on the 1.0 tool that now answers it, and the reply is read back in the shape the invariant already
 * knows how to judge, with the NOTES the new tools carry standing in for the fields they replaced. The mapping is one pure
 * function per tool and is itself tested (tests/eval-legacy.test.ts), so an invariant cannot pass because the translation
 * invented a field the server never sent.
 *
 * Two things stay real. The traces the session records (what `outputMatchesDeclaredSchema` and the cost budget read) are the
 * 1.0 calls and their raw bodies, never the translated ones. And a probe of a tool that no longer exists (an area overview,
 * a tree walk) is an error, so an invariant that still needs one fails loudly instead of binding on nothing.
 */
import { preAdoptionPlaceholders } from "../src/placeholders.ts";
import { estimateTokens, type CallTrace } from "./harness.ts";

type Raw = (tool: string, args: Record<string, unknown>) => Promise<CallTrace>;
type Json = Record<string, unknown>;
type Note = { type: string; text: string; applies_to?: string[] };

const obj = (j: unknown): Json => (typeof j === "object" && j !== null ? (j as Json) : {});
const notesOf = (j: Json): Note[] => (Array.isArray(j["notes"]) ? (j["notes"] as Note[]) : []);
const textOf = (notes: Note[], type: string): string | undefined => notes.filter((n) => n.type === type).map((n) => n.text).join(" ") || undefined;

function reply(from: CallTrace, tool: string, args: Record<string, unknown>, json: unknown): CallTrace {
  const text = JSON.stringify(json);
  return { ...from, tool, args, text, chars: text.length, tokens: estimateTokens(text), json };
}

/** The tools of 0.x that 1.0 removed: no answer exists, and pretending to have one would make an invariant bind on nothing. */
const REMOVED = new Set(["list_review_areas", "get_area_overview", "get_coverage_gaps", "expand_regulation", "get_regulation_tree", "expand_playbook", "get_referrers"]);

const SEARCH_SCOPE: Record<string, string> = { search_regulation: "provisions", search_checks: "checks", search_tests: "tests", search_playbooks: "playbooks" };

export function isLegacyTool(tool: string): boolean {
  return REMOVED.has(tool) || tool in SEARCH_SCOPE || ["get_corpus_info", "list_sources", "get_source", "get_regulation", "get_check", "get_test", "get_playbook", "resolve_citation"].includes(tool);
}

// --- pure translations -------------------------------------------------------------------------------------------

/** `sources` → what `get_corpus_info` said. */
export function corpusInfoFrom(j: Json): Json {
  const docs = (Array.isArray(j["documents"]) ? j["documents"] : []) as Json[];
  const holdings = docs.map((d) => ({
    document_id: d["document_id"],
    framework: d["framework"],
    ...(typeof d["title"] === "string" ? { title: d["title"] } : {}),
    records: typeof d["provisions"] === "number" ? d["provisions"] : 0,
    ...(d["held"] === "part" ? { partial: true } : d["held"] === "whole" ? { partial: false } : {}),
  }));
  const counts = obj(j["counts"]);
  return {
    last_updated: "",
    counts,
    coverage: docs.map((d) => String(d["document_id"]).toUpperCase()),
    stale_sources: j["overdue_for_check"] ?? [],
    holdings,
    ...(j["changes"] === undefined ? {} : { pending_changes: j["changes"] }),
  };
}

/** `get` of one provision → the record with the notes as the fields they replaced. */
export function provisionFrom(j: Json): Json {
  const rec = obj((Array.isArray(j["records"]) ? j["records"] : [])[0]);
  const notes = notesOf(j);
  const asOf = textOf(notes, "version");
  const pending = textOf(notes, "amendment");
  const hasPlaceholder = notes.some((n) => n.type === "placeholder");
  const found = hasPlaceholder && typeof rec["text"] === "string" ? preAdoptionPlaceholders(rec["text"]) : null;
  return {
    ...(asOf === undefined ? {} : { as_of_note: asOf }),
    ...(pending === undefined ? {} : { pending_changes_note: pending }),
    ...(found === null ? {} : { pre_adoption_placeholders: found.spans, notice: textOf(notes, "placeholder") }),
    ...rec,
  };
}

/** `cite` → the 0.x resolution. */
export function resolutionFrom(j: Json): Json {
  const notes = notesOf(j);
  const { notes: _n, official_citation: _o, ...rest } = j;
  void _n;
  void _o;
  const coverage = textOf(notes, "outside_library");
  const pending = textOf(notes, "amendment");
  return { ...(pending === undefined ? {} : { pending_changes_note: pending }), ...rest, ...(coverage === undefined ? {} : { coverage_note: coverage }) };
}

/** `search` → the 0.x envelope, whose notice carried the weak-match and amendment sentences after any truncation sentence. */
export function envelopeFrom(j: Json): Json {
  const { notes: _n, ...rest } = j;
  void _n;
  const sentences = [typeof j["notice"] === "string" ? j["notice"] : undefined, textOf(notesOf(j), "weak_match"), textOf(notesOf(j), "amendment")].filter((x): x is string => x !== undefined);
  return { ...rest, ...(sentences.length === 0 ? {} : { notice: sentences.join(" ") }) };
}

/** `sources` rows → what `list_sources` listed. */
export function sourceListFrom(j: Json): Json {
  const docs = (Array.isArray(j["documents"]) ? j["documents"] : []) as Json[];
  return {
    sources: docs.map((d) => ({
      id: d["id"],
      title: d["title"],
      status: d["status"],
      verified: d["verified"],
      ...(d["effective_from"] === undefined ? {} : { effective_from: d["effective_from"] }),
      ...(d["superseded_by"] === undefined ? {} : { superseded_by: d["superseded_by"] }),
      ...(d["next_milestone"] === undefined ? {} : { next_milestone: d["next_milestone"] }),
      ...(d["open_changes"] === undefined ? {} : { open_pending_changes: d["open_changes"] }),
    })),
  };
}

// --- the call -------------------------------------------------------------------------------------------------------

export async function legacyCall(raw: Raw, tool: string, args: Record<string, unknown>): Promise<CallTrace> {
  if (REMOVED.has(tool)) {
    const text = `${tool} no longer exists in this library's tools.`;
    return { tool, args, text, chars: text.length, tokens: estimateTokens(text), ms: 0, isError: true, json: null };
  }
  const scope = SEARCH_SCOPE[tool];
  if (scope !== undefined) {
    const t = await raw("search", { ...args, scope });
    return t.isError || t.json === null ? { ...t, tool, args } : reply(t, tool, args, envelopeFrom(obj(t.json)));
  }
  switch (tool) {
    case "get_corpus_info": {
      const t = await raw("sources", {});
      return t.isError || t.json === null ? { ...t, tool, args } : reply(t, tool, args, corpusInfoFrom(obj(t.json)));
    }
    case "list_sources": {
      const t = await raw("sources", {});
      return t.isError || t.json === null ? { ...t, tool, args } : reply(t, tool, args, sourceListFrom(obj(t.json)));
    }
    case "get_source": {
      const t = await raw("sources", { id: args["id"] });
      return { ...t, tool, args };
    }
    case "get_regulation": {
      const t = await raw("get", { ids: args["id"], ...(args["as_of"] === undefined ? {} : { as_of: args["as_of"] }) });
      return t.isError || t.json === null ? { ...t, tool, args } : reply(t, tool, args, provisionFrom(obj(t.json)));
    }
    case "get_check":
    case "get_test": {
      const t = await raw("get", { ids: args["id"] });
      if (t.isError || t.json === null) return { ...t, tool, args };
      return reply(t, tool, args, obj((Array.isArray(obj(t.json)["records"]) ? (obj(t.json)["records"] as unknown[]) : [])[0]));
    }
    case "get_playbook": {
      const t = await raw("playbook", { id: args["id"] });
      return { ...t, tool, args };
    }
    case "resolve_citation": {
      const t = await raw("cite", args);
      return t.isError || t.json === null ? { ...t, tool, args } : reply(t, tool, args, resolutionFrom(obj(t.json)));
    }
    default:
      return raw(tool, args);
  }
}
