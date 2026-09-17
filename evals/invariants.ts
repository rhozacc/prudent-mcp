/**
 * Context-quality invariants.
 *
 * These are properties of the SERVER, not of any particular corpus: each is
 * expressed over what a model is handed and can be evaluated against the demo
 * corpus in CI or a real one locally. That is deliberate — a quality bar that
 * only holds for one corpus is a fixture, not a bar.
 *
 * The failure they are all aimed at is the same one: **a model believing
 * something the corpus did not say.** Volume is a cost; a confident wrong
 * answer is a defect. So the fatal findings here are about truthfulness
 * (I1–I4, I7) and the budgeted ones about cost (I5–I6).
 *
 * Every invariant reports `applicable: false` rather than passing when it had
 * nothing to bind on — a check that passes by having nothing to measure is the
 * exact failure mode this file exists to catch.
 */
import type { Finding, InvariantResult, Session } from "./harness.ts";

const SCHEMES = ["regulation", "check", "test", "playbook", "source"] as const;
type Scheme = (typeof SCHEMES)[number];

const GETTER: Record<Scheme, string> = {
  regulation: "get_regulation",
  check: "get_check",
  test: "get_test",
  playbook: "get_playbook",
  source: "get_source",
};

/** Every `scheme://…` token appearing in a string. */
function uris(s: string): string[] {
  const out = new Set<string>();
  // A path segment is required: a bare "playbook://" is prose naming the
  // scheme ("pass a playbook:// id"), not a claim that a record exists.
  for (const m of s.matchAll(/\b(regulation|check|test|playbook|source):\/\/[^\s"'`,)\]}]+/g)) {
    const uri = m[0].replace(/[.,;]+$/, "");
    if (uri.split("://")[1] !== "") out.add(uri);
  }
  return [...out];
}

const schemeOf = (uri: string): Scheme | null => {
  const s = uri.split("://")[0];
  return (SCHEMES as readonly string[]).includes(s ?? "") ? (s as Scheme) : null;
};

// ============================================================================
// I1 — the response body is machine-readable
// ============================================================================

/**
 * A tool that returns JSON followed by a sentence of prose is not returning
 * JSON. Consumers that parse (and the MCP structured-content contract) break on
 * it, and the model is handed a body it cannot rely on the shape of.
 */
export async function envelopeIsJson(s: Session): Promise<InvariantResult> {
  const probes: Array<[string, Record<string, unknown>]> = [
    ["get_corpus_info", {}],
    ["list_review_areas", {}],
    ["list_sources", {}],
    ["search_regulation", { query: "default", limit: 1 }],
    ["search_checks", { query: "default", limit: 1 }],
    ["search_tests", { query: "default", limit: 1 }],
    ["search_playbooks", { query: "default", limit: 1 }],
    ["get_coverage_gaps", {}],
  ];
  const findings: Finding[] = [];
  let bound = 0;
  for (const [tool, args] of probes) {
    const t = await s.call(tool, args);
    if (t.isError) continue;
    bound++;
    if (t.json === null) {
      const tail = t.text.slice(t.text.lastIndexOf("}") + 1).trim();
      findings.push({
        id: `I1/${tool}`,
        severity: "fatal",
        summary: `${tool} returns a body that is not valid JSON — a consumer that parses it fails.`,
        evidence: [
          `bytes after the final "}": ${JSON.stringify(tail.slice(0, 200))}`,
          `body length ${t.chars}c`,
        ],
      });
    }
  }
  return { id: "I1", title: "Response bodies are valid JSON", applicable: bound > 0, findings };
}

// ============================================================================
// I2 — tool descriptions do not teach ids that do not exist
// ============================================================================

/**
 * Tool descriptions are read once and believed for the whole session. An
 * example id in a description is the strongest signal a model gets about how
 * this corpus is addressed — so an example that cannot be fetched teaches the
 * model to construct ids that never resolve, and it will keep doing it.
 */
export async function describedIdsResolve(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];
  let bound = 0;
  for (const tool of s.tools) {
    // The input SCHEMA is scanned alongside the description. A model reads both
    // as one instruction, and the per-field `describe()` is where example ids
    // actually live — which is how eight of them sat unchecked while this
    // invariant reported nothing to bind on.
    const surface = `${tool.name} ${tool.description} ${tool.schemaText}`;
    for (const uri of uris(surface)) {
      const scheme = schemeOf(uri);
      if (scheme === null) continue;
      // Template placeholders are documentation, not claims about content.
      if (/[{}<>]|\.\.\./.test(uri)) continue;
      bound++;
      const t = await s.call(GETTER[scheme], { id: uri });
      if (t.isError) {
        findings.push({
          id: `I2/${tool.name}`,
          severity: "fatal",
          summary: `${tool.name}'s description gives ${uri} as an example, but that id does not resolve — the description teaches an addressing scheme the served corpus does not use.`,
          evidence: [`${GETTER[scheme]}("${uri}") → ${t.text.slice(0, 160)}`],
        });
      }
    }
  }
  return {
    id: "I2",
    title: "Ids shown in tool descriptions resolve",
    applicable: bound > 0,
    findings,
  };
}

// ============================================================================
// I3 — citation resolution is honest
// ============================================================================

/**
 * The hardest defect to see from inside the code: a resolver that always
 * resolves. Fuzzy containment turns "Article 501" into article 50 and an
 * instrument the corpus does not hold into one it does — and returns it with no
 * signal of doubt. For a regulatory tool this is the worst possible failure,
 * because the model presents it as a citation.
 *
 * Corpus-agnostic formulation: ask for an article number that is provably NOT
 * in the corpus and require null. Then ask for one that IS, and require exactly
 * that number back.
 */
export async function citationResolutionIsHonest(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];

  // Discover real article numbers from ids the server itself hands out.
  const seen = new Set<number>();
  for (const q of ["default", "estimation", "risk", "data", "model"]) {
    const t = await s.call("search_regulation", { query: q, limit: 20 });
    for (const m of t.text.matchAll(/article-(\d+)/g)) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) seen.add(n);
    }
  }
  if (seen.size === 0) {
    return {
      id: "I3",
      title: "Citation resolution is honest",
      applicable: false,
      findings: [
        {
          id: "I3/no-articles",
          severity: "info",
          summary: "No article-numbered ids were observed, so citation honesty could not be tested.",
          evidence: ["searched 5 common terms, found no `article-N` id segment"],
        },
      ],
    };
  }

  const maxSeen = Math.max(...seen);
  const absent = maxSeen + 1000; // provably not in the corpus
  const present = maxSeen;

  const miss = await s.call("resolve_citation", { text: `Article ${absent}` });
  const missMatch = /"id"\s*:\s*"([^"]+)"/.exec(miss.text)?.[1];
  if (missMatch !== undefined) {
    findings.push({
      id: "I3/fabricates",
      severity: "fatal",
      summary: `resolve_citation invents a match for a citation the corpus cannot contain — it answered "Article ${absent}" with a different provision instead of null.`,
      evidence: [
        `highest article number observed in the corpus: ${maxSeen}`,
        `resolve_citation("Article ${absent}") → ${missMatch}`,
        "a resolver that always resolves gives the model no way to tell a hit from a guess",
      ],
    });
  }

  const hit = await s.call("resolve_citation", { text: `Article ${present}` });
  const hitMatch = /"id"\s*:\s*"([^"]+)"/.exec(hit.text)?.[1];
  if (hitMatch !== undefined && !hitMatch.includes(`article-${present}`)) {
    findings.push({
      id: "I3/wrong-number",
      severity: "fatal",
      summary: `resolve_citation returned a different provision than the one asked for — "Article ${present}" resolved to ${hitMatch}.`,
      evidence: [`expected an id containing "article-${present}", got "${hitMatch}"`],
    });
  }

  // A citation naming an instrument the corpus does not cover must not be
  // answered out of an instrument it does.
  const foreign = await s.call("resolve_citation", {
    text: "Article 1 of Regulation (EU) No 9999/9999",
  });
  const foreignMatch = /"id"\s*:\s*"([^"]+)"/.exec(foreign.text)?.[1];
  if (foreignMatch !== undefined) {
    findings.push({
      id: "I3/wrong-instrument",
      severity: "fatal",
      summary:
        "resolve_citation answers a citation into an instrument the corpus does not hold, sourcing the match from an unrelated document.",
      evidence: [
        `resolve_citation("Article 1 of Regulation (EU) No 9999/9999") → ${foreignMatch}`,
        "the model will attribute this text to the instrument the user named",
      ],
    });
  }

  return { id: "I3", title: "Citation resolution is honest", applicable: true, findings };
}

// ============================================================================
// I4 — reported totals are true
// ============================================================================

/**
 * `total_matches` is how a model decides whether it has seen everything. If it
 * reports the size of a capped scan rather than the size of the match set, the
 * model stops paging while most of the answer is still unread — and reports
 * completeness it does not have.
 */
export async function totalsAreTruthful(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];
  const surfaces: Array<[string, string]> = [
    ["search_regulation", "regulation"],
    ["search_checks", "check"],
    ["search_tests", "test"],
  ];

  // Corpus size comes from the server itself, so this stays corpus-agnostic.
  const info = await s.call("get_corpus_info");
  const counts = new Map<string, number>();
  for (const m of info.text.matchAll(/"(regulation|check|test|playbook|source)"\s*:\s*(\d+)/g)) {
    counts.set(m[1] ?? "", Number(m[2]));
  }

  const total = (text: string): number =>
    Number(/"total_matches"\s*:\s*(\d+)/.exec(text)?.[1] ?? NaN);

  let bound = 0;
  for (const [tool, surface] of surfaces) {
    // Ranking scores a record if it matches ANY query token, so adding tokens
    // can only widen the match set. total_matches must be non-decreasing.
    const narrow = await s.call(tool, { query: "default", limit: 100 });
    const wide = await s.call(tool, {
      query: "default risk data model estimation exposure",
      limit: 100,
    });
    const nNarrow = total(narrow.text);
    const nWide = total(wide.text);
    if (!Number.isFinite(nNarrow) || !Number.isFinite(nWide)) continue;
    bound++;

    if (nWide < nNarrow) {
      findings.push({
        id: `I4/${tool}-monotonic`,
        severity: "fatal",
        summary: `${tool} reports fewer matches for a strictly wider query — total_matches is not a count of the match set.`,
        evidence: [`"default" → ${nNarrow}`, `"default risk data model estimation exposure" → ${nWide}`],
      });
      continue;
    }

    // A count that cannot move as the query widens, on a surface far larger
    // than the count, is a page cap being reported as a total.
    const population = counts.get(surface) ?? 0;
    const rows = (wide.text.match(/"id"\s*:/g) ?? []).length;
    if (nNarrow === nWide && nWide === rows && population > nWide * 2) {
      findings.push({
        id: `I4/${tool}-capped`,
        severity: "fatal",
        summary: `${tool} reports total_matches ${nWide} for every query, equal to the rows it returned, across a surface of ${population} records — the model is told a page size is the answer's size and will stop paging.`,
        evidence: [
          `"default" → ${nNarrow}; six-token superset → ${nWide}; rows returned ${rows}`,
          `${surface} records in the corpus: ${population}`,
          "widening the query cannot shrink the match set, so an unmoving figure is a cap",
        ],
      });
    }
  }
  return { id: "I4", title: "Reported totals are true", applicable: bound > 0, findings };
}

// ============================================================================
// I5 — every id handed to a model is fetchable
// ============================================================================

/**
 * Ids move between tools: search hands them to get, overviews hand them to
 * traversal. An id that appears in one response and 404s in the next is a dead
 * end the model cannot predict, and it burns a call to discover.
 */
export async function idsRoundTrip(s: Session): Promise<InvariantResult> {
  const seeds: Array<[string, Record<string, unknown>]> = [
    ["search_regulation", { query: "default", limit: 5 }],
    ["search_checks", { query: "default", limit: 5 }],
    ["search_tests", { query: "default", limit: 5 }],
    ["search_playbooks", { query: "default", limit: 5 }],
    ["list_sources", {}],
    ["get_coverage_gaps", {}],
  ];
  const found = new Set<string>();
  for (const [tool, args] of seeds) {
    const t = await s.call(tool, args);
    if (t.isError) continue;
    for (const u of uris(t.text)) found.add(u);
  }
  const findings: Finding[] = [];
  let bound = 0;
  for (const uri of [...found].slice(0, 40)) {
    const scheme = schemeOf(uri);
    if (scheme === null) continue;
    bound++;
    const t = await s.call(GETTER[scheme], { id: uri });
    if (t.isError) {
      findings.push({
        id: `I5/${uri}`,
        severity: "fatal",
        summary: `${uri} was handed to the model by a search result but ${GETTER[scheme]} cannot fetch it.`,
        evidence: [t.text.slice(0, 160)],
      });
    }
  }
  return { id: "I5", title: "Ids handed out are fetchable", applicable: bound > 0, findings };
}

// ============================================================================
// I6 — context cost stays inside a budget
// ============================================================================

export interface Budget {
  /** Standing cost of publishing the tool surface. */
  surface: number;
  /** A search or single-record response. */
  call: number;
  /**
   * A documented one-shot BUNDLE (get_area_overview), which exists to replace a
   * dozen calls and is priced accordingly. Higher than `call`, and still a
   * ceiling: the distinction is between a response that is large because it was
   * asked to be and one that is large because nothing bounds it.
   */
  bundle: number;
  /** get_corpus_info → list_review_areas → get_area_overview. */
  entryPath: number;
}

/**
 * `entryPath` has to accommodate one bundle plus the two cheap calls before it,
 * or the finding fires on every corpus and stops carrying information. It is
 * set to catch the entry path GROWING, not to argue the bundle should not exist.
 */
export const DEFAULT_BUDGET: Budget = {
  surface: 3000,
  call: 6000,
  bundle: 9000,
  entryPath: 8000,
};

/**
 * Context is the scarce resource; a tool that spends 60k tokens answering one
 * question has taken the budget the model needed for the actual task. These are
 * ceilings on what a single call may cost, not targets.
 */
export async function costWithinBudget(
  s: Session,
  budget: Budget = DEFAULT_BUDGET,
): Promise<InvariantResult> {
  const findings: Finding[] = [];

  if (s.surfaceTokens > budget.surface) {
    findings.push({
      id: "I6/surface",
      severity: "warn",
      summary: `Publishing ${s.tools.length} tools costs ~${s.surfaceTokens} tokens of context before a single question is asked (budget ${budget.surface}).`,
      evidence: s.tools
        .slice()
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5)
        .map((t) => `${t.name}: ~${t.tokens} tok (desc ${t.description.length}c + schema ${t.schemaChars}c)`),
    });
  }

  const info = await s.call("get_corpus_info");
  const areas = await s.call("list_review_areas");
  const firstArea = /"id"\s*:\s*"([^"]+)"/.exec(areas.text)?.[1];
  let overview = { tokens: 0, tool: "get_area_overview" };
  if (firstArea !== undefined) {
    const t = await s.call("get_area_overview", { area: firstArea });
    overview = { tokens: t.tokens, tool: "get_area_overview" };
  }
  const entry = info.tokens + areas.tokens + overview.tokens;
  if (entry > budget.entryPath) {
    findings.push({
      id: "I6/entry-path",
      severity: "warn",
      summary: `The documented entry path costs ~${entry} tokens before the model has read a single provision (budget ${budget.entryPath}).`,
      evidence: [
        `get_corpus_info ${info.tokens}`,
        `list_review_areas ${areas.tokens}`,
        `get_area_overview("${firstArea}") ${overview.tokens}`,
      ],
    });
  }

  // Widest realistic single calls.
  const wide: Array<[string, Record<string, unknown>]> = [
    ["search_regulation", { query: "default", detail: "full" }],
    ["search_checks", { query: "default", detail: "full" }],
  ];
  if (firstArea !== undefined) wide.push(["get_area_overview", { area: firstArea, detail: "full" }]);
  for (const [tool, args] of wide) {
    const t = await s.call(tool, args);
    if (t.isError) continue;
    const ceiling = tool === "get_area_overview" ? budget.bundle : budget.call;
    if (t.tokens > ceiling) {
      findings.push({
        id: `I6/${tool}`,
        severity: "fatal",
        summary: `${tool}(${JSON.stringify(args)}) returns ~${t.tokens} tokens in one call (ceiling ${ceiling}).`,
        evidence: [`${t.chars} chars in ${t.ms}ms`],
      });
    }
  }

  return { id: "I6", title: "Context cost stays within budget", applicable: true, findings };
}

// ============================================================================
// I7 — a miss says so, and says where to go
// ============================================================================

/**
 * A model that gets `null` with no direction retries the same shape. A miss is
 * a routing opportunity: it should name the tool that would have worked.
 */
export async function missesAreActionable(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];
  const probes: Array<[string, Record<string, unknown>]> = [
    ["get_regulation", { id: "regulation://nope/nothing-here" }],
    ["get_check", { id: "check://nope/nothing-here" }],
    ["get_area_overview", { area: "no-such-area-at-all" }],
  ];
  let bound = 0;
  for (const [tool, args] of probes) {
    const t = await s.call(tool, args);
    bound++;
    if (!t.isError) {
      findings.push({
        id: `I7/${tool}-silent`,
        severity: "fatal",
        summary: `${tool} answered a nonsense id without signalling an error — the model cannot tell a miss from a hit.`,
        evidence: [t.text.slice(0, 160)],
      });
      continue;
    }
    const namesATool = s.tools.some((x) => x.name !== tool && t.text.includes(x.name));
    if (!namesATool) {
      findings.push({
        id: `I7/${tool}-unrouted`,
        severity: "warn",
        summary: `${tool}'s miss message does not name another tool to try.`,
        evidence: [t.text.slice(0, 160)],
      });
    }
  }
  return { id: "I7", title: "Misses are actionable", applicable: bound > 0, findings };
}

// ============================================================================

// ============================================================================
// I8 — a record can be found by its own words, and answering is affordable
// ============================================================================

/**
 * The benchmark that matters most, and the only one that measures the product
 * rather than the plumbing: take a record the corpus already holds, query with
 * the words that make it distinctive, and see whether the server gives it back
 * — at what rank, and at what cost.
 *
 * Corpus-agnostic because the questions are derived from the served corpus
 * itself: every probe is "find the thing you told me you have".
 *
 * Two things are measured:
 *   rank    — is the record that owns these words in the top results at all?
 *   density — of the tokens spent, how many were the answer? A concise excerpt
 *             that cannot be quoted forces the model to open the full record,
 *             so the honest cost is search + open, not search alone.
 */
/** A statement end: sentence terminators plus the `;` ending an enumerated point. */
const QUOTABLE_END = /[.!?;]["')\]]?$/;
/** An enumeration marker at the head of a fragment: "(c) ", "(iv)", "3) ". */
const ENUM_HEAD = /^\s*\(?[a-z0-9]{1,3}\)/i;
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Is this excerpt something the caller can quote and answer from, or only a
 * pointer to the record it came from?
 *
 * Four conditions, and each one closes a way of passing the other three.
 *
 *  1. Truncation is derived from the SOURCE, never from the ellipsis. The two
 *     "…" markers are a decoration makeExcerpt controls: deleting them takes
 *     this bar from ~70% to 100% without changing a single excerpt, which is
 *     the cheapest cheat available anywhere in the suite. When `source` is
 *     given, "was it cut?" is a length comparison against the field itself.
 *  2. It ends where a statement ends. A colon is NOT a statement end — it
 *     promises an enumeration the excerpt does not carry.
 *  3. It does not BEGIN on an enumerated limb. "(c) include an additional
 *     margin of conservatism…" has lost the chapeau carrying its addressee and
 *     its trigger, and quoting it is the same defect class as a confident wrong
 *     citation.
 *  4. It appears in the field VERBATIM. Conditions 1-3 alone are satisfied by
 *     appending a full stop to whatever the budget cut, which would turn this
 *     bar into a lint on the last byte.
 *
 * The one case this still correctly refuses is a bounded window inside a single
 * statement longer than the excerpt budget — there is no way to end that at a
 * boundary without serving the record, so it stays a pointer.
 */
export function excerptIsQuotable(excerpt: string, recordBody?: string): boolean {
  const body = excerpt.replace(/^…/, "").replace(/…$/, "").trim();
  if (body.length === 0) return false;
  const want = flat(body);

  if (recordBody !== undefined) {
    // The excerpt may come from ANY searched field — citation, text, or one of
    // the commentary entries — and the concise projection does not say which.
    // Find the field that actually contains it, then judge truncation against
    // THAT field's length. Comparing against the whole record would call a
    // short complete citation "truncated"; comparing against `text` alone
    // would call a commentary hit "not verbatim".
    const fields = [...recordBody.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => flat(m[1] ?? ""));
    const host = fields.find((f) => f.includes(want));
    if (host === undefined) return false; // (4) not verbatim in any field
    if (host.length <= want.length) return true; // (1) nothing was cut
  } else if (!excerpt.startsWith("…") && !excerpt.endsWith("…")) {
    return true; // no record to check against; fall back to the marker
  }

  if (ENUM_HEAD.test(body)) return false; // (3) orphaned limb
  return QUOTABLE_END.test(body); // (2)
}

/**
 * Share of excerpts that must be quotable before the excerpt is doing its job.
 * Not 100%: a corpus whose prose runs to sentences longer than the excerpt
 * budget will always have a residue, and that is the corpus's shape rather than
 * a defect in the server.
 */
const QUOTABLE_BAR = 0.8;

export async function selfRetrievalIsAffordable(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];

  // Sample records from the server's own search output, then re-query using the
  // rarest words in each record's excerpt.
  //
  // Six unrelated seeds, not one. Five probes drawn from a single query is not
  // a sample: at a true rate near the bar it quantises to five points and turns
  // over on one record, so the same corpus and the same code could report 40%
  // or 80% on consecutive runs. Widening the seed set is what makes the number
  // mean something — and it costs six calls.
  const SEED_QUERIES = [
    "requirements estimation data",
    "downturn calibration",
    "margin of conservatism",
    "definition of default days past due",
    "rating system validation",
    "collateral valuation haircut",
  ];
  const PROBE_TARGET = 24;

  const ids: string[] = [];
  for (const q of SEED_QUERIES) {
    const seed = await s.call("search_regulation", { query: q, limit: 10 });
    for (const m of seed.text.matchAll(/"id"\s*:\s*"(regulation:\/\/[^"]+)"/g)) {
      const found = m[1];
      if (found !== undefined && !ids.includes(found)) ids.push(found);
    }
  }
  if (ids.length === 0) {
    return {
      id: "I8",
      title: "Records are findable by their own words, affordably",
      applicable: false,
      findings: [
        {
          id: "I8/no-seed",
          severity: "info",
          summary: "No regulation records were returned to sample, so retrieval could not be measured.",
          evidence: [`${SEED_QUERIES.length} seed queries returned no ids`],
        },
      ],
    };
  }

  const STOP = new Set("the a an and or of to in for on by with that this which be is are as at from should must may not it its institutions institution".split(" "));
  let probes = 0;
  let found = 0;
  let pathTokens = 0;
  let unusableExcerpts = 0;

  for (const id of ids.slice(0, PROBE_TARGET)) {
    const rec = await s.call("get_regulation", { id });
    if (rec.isError) continue;
    const text = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(rec.text)?.[1] ?? "";
    const words = [...new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
    if (words.length < 4) continue;
    // Mid-frequency words: distinctive to this record without being one-offs.
    const query = words.slice(Math.floor(words.length / 3), Math.floor(words.length / 3) + 5).join(" ");
    probes++;

    const back = await s.call("search_regulation", { query, limit: 10 });
    const returned = [...back.text.matchAll(/"id"\s*:\s*"(regulation:\/\/[^"]+)"/g)].map((m) => m[1]);
    const rank = returned.indexOf(id);
    if (rank >= 0) found++;
    else {
      findings.push({
        id: `I8/unfindable`,
        severity: "warn",
        summary: `A record is not in the top 10 for a query built from its own distinctive words — the model cannot reach it by describing what it wants.`,
        evidence: [`id ${id}`, `query "${query}"`, `top hit instead: ${returned[0] ?? "(none)"}`],
      });
    }

    // Honest cost of answering: the search, plus opening the top hit ONLY when
    // the excerpt could not have been quoted. Charging the open unconditionally
    // measures the same number however good the excerpts get, which makes the
    // metric blind to the thing it exists to track.
    // Score the excerpt belonging to THIS record against THIS record's own
    // text. Taking the first excerpt in the page scored whichever record
    // happened to rank top, against no source at all — so the verbatim and
    // truncation conditions had nothing to check and the bar was a lint on the
    // last byte.
    const own = back.text.indexOf(`"${id}"`);
    const excerpt =
      (own === -1
        ? /"matched_excerpt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(back.text)
        : /"matched_excerpt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(back.text.slice(own)))?.[1] ?? "";
    const usable = excerptIsQuotable(excerpt, own === -1 ? undefined : rec.text);
    if (!usable) unusableExcerpts++;
    const topId = returned[0];
    let open = 0;
    if (!usable && topId !== undefined) {
      const t = await s.call("get_regulation", { id: topId });
      open = t.tokens;
    }
    pathTokens += back.tokens + open;
  }

  if (probes === 0) {
    return {
      id: "I8",
      title: "Records are findable by their own words, affordably",
      applicable: false,
      findings,
    };
  }

  if (found < probes) {
    // already reported per-record above
  }
  const quotable = probes - unusableExcerpts;
  if (quotable / probes < QUOTABLE_BAR) {
    findings.push({
      id: "I8/excerpt-unusable",
      severity: "fatal",
      summary: `Only ${quotable} of ${probes} search excerpts can be quoted (bar ${Math.round(QUOTABLE_BAR * 100)}%) — the rest end mid-clause, so answering from them costs a second call to open the full record.`,
      evidence: [
        `mean cost of answering: ~${Math.round(pathTokens / probes)} tokens per question (search, plus an open only where the excerpt was unusable)`,
        "an excerpt that cannot be quoted is a pointer, not context",
      ],
    });
  } else if (unusableExcerpts > 0) {
    findings.push({
      id: "I8/excerpt-residue",
      severity: "info",
      summary: `${quotable} of ${probes} excerpts are quotable; ${unusableExcerpts} fall inside a single sentence longer than the excerpt budget.`,
      evidence: [`mean cost of answering: ~${Math.round(pathTokens / probes)} tokens per question`],
    });
  }

  return {
    id: "I8",
    title: "Records are findable by their own words, affordably",
    applicable: true,
    findings,
  };
}

// ============================================================================

// ============================================================================
// I16 — a tool returns what its published schema says it returns
// ============================================================================

/**
 * The output schema is the only machine-readable promise this server makes
 * about the SHAPE of a response, and nothing in the toolchain checks it against
 * the handler. `tsc` does not: a body assembled by spread satisfies the
 * handler's return type while carrying keys the schema never names. `satisfies`
 * does not, for the same reason. Until the envelopes were opened the only thing
 * that noticed was a validating client, at runtime, in production — and it
 * noticed by rejecting the response.
 *
 * Opening the envelopes fixed the rejection and traded it for silence: an
 * undeclared key is now served happily and documented nowhere. So this is a
 * warn, not a fatal — the response is usable, but a caller reading the schema
 * to decide what to parse is reading an incomplete list.
 *
 * Corpus-agnostic: every probe is a tool of this server called with arguments
 * derived from its own output.
 */
export async function outputMatchesDeclaredSchema(s: Session): Promise<InvariantResult> {
  const findings: Finding[] = [];
  const declared = new Map<string, Set<string>>();
  for (const t of s.tools) {
    const os = t.outputSchema as { properties?: Record<string, unknown> } | undefined;
    if (os?.properties === undefined) continue;
    declared.set(t.name, new Set(Object.keys(os.properties)));
  }
  if (declared.size === 0) {
    return {
      id: "I16",
      title: "Responses match their published output schema",
      applicable: false,
      findings: [
        {
          id: "I16/no-schemas",
          severity: "info",
          summary: "No tool publishes an output schema, so response shape could not be checked.",
          evidence: [`${s.tools.length} tools listed`],
        },
      ],
    };
  }

  const probes: Array<[string, Record<string, unknown>]> = [
    ["get_corpus_info", {}],
    ["list_review_areas", {}],
    ["list_sources", {}],
    ["get_coverage_gaps", {}],
    ["search_regulation", { query: "default", limit: 2 }],
    ["search_checks", { query: "default", limit: 2 }],
    ["search_tests", { query: "default", limit: 2 }],
    ["search_playbooks", { query: "estimation", limit: 2 }],
    ["resolve_citation", { text: "Article 178" }],
  ];

  let bound = 0;
  for (const [tool, args] of probes) {
    const want = declared.get(tool);
    if (want === undefined) continue;
    const t = await s.call(tool, args);
    if (t.isError || t.json === null || typeof t.json !== "object") continue;
    bound++;
    const extra = Object.keys(t.json as Record<string, unknown>).filter((k) => !want.has(k));
    if (extra.length > 0) {
      findings.push({
        id: `I16/${tool}`,
        severity: "warn",
        summary: `${tool} returns ${extra.length} key(s) its published output schema does not declare — a caller reading the schema to decide what to parse is reading an incomplete list.`,
        evidence: [`undeclared: ${extra.join(", ")}`, `declared: ${[...want].join(", ")}`],
      });
    }
  }

  return {
    id: "I16",
    title: "Responses match their published output schema",
    applicable: bound > 0,
    findings,
  };
}

export const ALL = [
  envelopeIsJson,
  describedIdsResolve,
  citationResolutionIsHonest,
  totalsAreTruthful,
  idsRoundTrip,
  costWithinBudget,
  missesAreActionable,
  selfRetrievalIsAffordable,
  outputMatchesDeclaredSchema,
] as const;
