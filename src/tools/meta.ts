/**
 * Cross-cutting tools — operate across all five surfaces.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { playbookInArea, resolveArea } from "../areas.ts";
import type {
  AnyId,
  Check,
  CheckId,
  Playbook,
  PlaybookId,
  Regulation,
  RegulationId,
  ReviewArea,
  Test,
  TestId,
} from "../schema.ts";
import {
  CitationResolutionSchema,
  CorpusInfoSchema,
  ReferrersSchema,
  RegulationSchema,
  ReviewAreaSchema,
  anyIdSchema,
  playbookIdSchema,
  regulationIdSchema,
} from "../schema.ts";
import { READ_ONLY_HINTS, fitOrCompact, lenient, miss, ok, stripEdgeNoise } from "./shared.ts";

// ── Local return types ────────────────────────────────────────────────────────

type ResolvedReference =
  | { type: "regulation"; id: RegulationId; record: Regulation | null }
  | { type: "test";       id: TestId;       record: Test | null }
  | { type: "check";      id: CheckId;      record: Check | null }
  | { type: "playbook";   id: PlaybookId;   record: Playbook | null };

// Concise stub for a resolved reference: label is the citation for regulation,
// the name for tests/checks, area[/subarea] for playbooks — null when the
// reference does not resolve.
type ReferenceStub = { type: ResolvedReference["type"]; id: string; label: string | null };

type ExpandedPhase = { name: string; description: string; references: ResolvedReference[] };
type ConcisePhase  = { name: string; description: string; references: ReferenceStub[] };

type ExpandedPlaybook = {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: ExpandedPhase[];
  gates: string[];
  last_updated: string;
};

type ConciseExpandedPlaybook = Omit<ExpandedPlaybook, "phases"> & { phases: ConcisePhase[] };

// A phase without its reference stubs, carrying counts instead. Used by
// get_area_overview, where the stubs restate ids the same response already
// lists de-duplicated — twice the bytes for none of the information.
type WalkthroughPhase = {
  name: string;
  description: string;
  reference_counts: Record<ResolvedReference["type"], number>;
};

type PlaybookWalkthrough = Omit<ExpandedPlaybook, "phases"> & { phases: WalkthroughPhase[] };

type AreaOverview = {
  area: ReviewArea;
  playbooks: ExpandedPlaybook[] | ConciseExpandedPlaybook[] | PlaybookWalkthrough[];
  regulation_ids: RegulationId[];
  check_ids: CheckId[];
  test_ids: TestId[];
  /**
   * Playbooks referenced BY this area's playbooks, minus the ones already
   * listed above. Collected because some playbooks are indexes over others —
   * a lifecycle playbook's phases reference the per-parameter playbooks and
   * nothing else, so an overview that only gathered regulation/check/test ids
   * answered "1 playbook, 0 of everything" and left the caller to expand it
   * anyway. Which is the entry path failing at its second step.
   */
  playbook_ids: PlaybookId[];
};

type ExpandedRegulation = {
  id: RegulationId;
  citation: string;
  framework: string;
  document_version: string;
  text: string;
  parent: RegulationId | null;
  children: ResolvedReference[];
};

type ConciseExpandedRegulation = Omit<ExpandedRegulation, "children"> & { children: ReferenceStub[] };

type RegulationTreeLeaf =
  | { type: "test";  id: TestId;  record: Test | null }
  | { type: "check"; id: CheckId; record: Check | null };

type RegulationTreeNode = {
  type: "regulation";
  id: RegulationId;
  citation: string;
  record: Regulation | null;
  children: Array<RegulationTreeNode | RegulationTreeLeaf>;
  truncated?: boolean;
};

type ConciseTreeLeaf = { type: "test" | "check"; id: string; label: string | null };
type ConciseTreeNode = {
  type: "regulation";
  id: RegulationId;
  citation: string;
  children: Array<ConciseTreeNode | ConciseTreeLeaf>;
  truncated?: boolean;
};

type CoverageGap = { id: RegulationId; citation: string; is_leaf: boolean };
type CoverageReport = {
  total_regulations: number;
  covered: number;
  uncovered: CoverageGap[];
};

// Hard ceiling on nodes materialized by get_regulation_tree (root + regulation
// nodes + check/test leaves). Nodes cut off by the cap are flagged truncated.
const MAX_TREE_NODES = 200;

// ── Private helpers ───────────────────────────────────────────────────────────

// TypeScript can't narrow template literal types from startsWith, so each
// branch requires an explicit `as` cast after the prefix guard.
async function resolveReference(id: AnyId): Promise<ResolvedReference> {
  if (id.startsWith("regulation://"))
    return { type: "regulation", id: id as RegulationId, record: await adapters.regulation.get(id as RegulationId) };
  if (id.startsWith("test://"))
    return { type: "test", id: id as TestId, record: await adapters.test.get(id as TestId) };
  if (id.startsWith("check://"))
    return { type: "check", id: id as CheckId, record: await adapters.check.get(id as CheckId) };
  return { type: "playbook", id: id as PlaybookId, record: await adapters.playbook.get(id as PlaybookId) };
}

function stubOf(ref: ResolvedReference): ReferenceStub {
  const label =
    ref.record === null
      ? null
      : ref.type === "regulation"
        ? ref.record.citation
        : ref.type === "playbook"
          ? (ref.record.subarea !== undefined ? `${ref.record.area}/${ref.record.subarea}` : ref.record.area)
          : ref.record.name;
  return { type: ref.type, id: ref.id, label };
}

async function expandPlaybook(raw: Playbook): Promise<ExpandedPlaybook> {
  const phases = await Promise.all(
    raw.phases.map(async (ph) => ({
      name: ph.name,
      description: ph.description,
      references: await Promise.all(ph.references.map(resolveReference)),
    })),
  );
  return {
    id: raw.id,
    area: raw.area,
    // Spread pattern required by exactOptionalPropertyTypes — never assign undefined
    ...(raw.subarea !== undefined ? { subarea: raw.subarea } : {}),
    phases,
    gates: raw.gates,
    last_updated: raw.last_updated,
  };
}

/**
 * Playbook as a walkthrough summary: the phases and what each one draws on, by
 * count and type. The ids themselves live in the overview's flat lists, and
 * expand_playbook resolves them per phase when that grouping matters.
 */
function toPlaybookWalkthrough(pb: ExpandedPlaybook): PlaybookWalkthrough {
  return {
    ...pb,
    phases: pb.phases.map((ph) => {
      const reference_counts: Record<ResolvedReference["type"], number> = {
        regulation: 0,
        test: 0,
        check: 0,
        playbook: 0,
      };
      for (const ref of ph.references) reference_counts[ref.type] += 1;
      return { name: ph.name, description: ph.description, reference_counts };
    }),
  };
}

function toConcisePlaybook(pb: ExpandedPlaybook): ConciseExpandedPlaybook {
  return {
    ...pb,
    phases: pb.phases.map((ph) => ({
      name: ph.name,
      description: ph.description,
      references: ph.references.map(stubOf),
    })),
  };
}

// Fetch a regulation's children resolved one level deep. The reverse-direction
// companion to expandPlaybook — children may now be checks/tests, not just regs.
export async function expandRegulation(raw: Regulation): Promise<ExpandedRegulation> {
  const children = await Promise.all(raw.children.map(resolveReference));
  return {
    id: raw.id,
    citation: raw.citation,
    framework: raw.framework,
    document_version: raw.document_version,
    text: raw.text,
    parent: raw.parent ?? null,
    children,
  };
}

function toConciseRegulation(expanded: ExpandedRegulation): ConciseExpandedRegulation {
  return { ...expanded, children: expanded.children.map(stubOf) };
}

// Recursive dossier walk. Regulation children recurse (bounded by depth, a
// visited-set cycle guard, and a shared node budget); checks/tests are
// resolved leaves. Nodes cut off by any bound are flagged truncated.
export async function buildRegulationTree(
  id: RegulationId,
  depth: number,
  visited: Set<RegulationId>,
  asOf?: string,
  budget: { remaining: number } = { remaining: MAX_TREE_NODES },
): Promise<RegulationTreeNode> {
  budget.remaining -= 1; // this node
  const record = await adapters.regulation.get(id, asOf);
  const node: RegulationTreeNode = {
    type: "regulation",
    id,
    citation: record?.citation ?? id,
    record,
    children: [],
  };
  if (record === null) return node;
  if (depth <= 0 || visited.has(id)) {
    if (record.children.length > 0) node.truncated = true;
    return node;
  }
  visited.add(id);
  for (const childId of record.children) {
    if (budget.remaining <= 0) {
      node.truncated = true;
      break;
    }
    if (childId.startsWith("regulation://")) {
      node.children.push(await buildRegulationTree(childId as RegulationId, depth - 1, visited, asOf, budget));
    } else if (childId.startsWith("test://")) {
      budget.remaining -= 1;
      node.children.push({ type: "test", id: childId as TestId, record: await adapters.test.get(childId as TestId) });
    } else {
      budget.remaining -= 1;
      node.children.push({ type: "check", id: childId as CheckId, record: await adapters.check.get(childId as CheckId) });
    }
  }
  return node;
}

function toConciseTree(node: RegulationTreeNode): ConciseTreeNode {
  return {
    type: "regulation",
    id: node.id,
    citation: node.citation,
    children: node.children.map((c) =>
      c.type === "regulation"
        ? toConciseTree(c)
        : { type: c.type, id: c.id, label: c.record?.name ?? null },
    ),
    ...(node.truncated === true ? { truncated: true } : {}),
  };
}

// Which regulations have no check/test pointing at them via derived_from /
// regulatory_basis — the aggregate inverse of the get_referrers scan. Pure over
// the supplied records.
export function computeCoverageGaps(
  regulations: Regulation[],
  checks: Check[],
  tests: Test[],
): CoverageReport {
  const covered = new Set<RegulationId>();
  for (const c of checks) for (const r of c.derived_from) covered.add(r);
  for (const t of tests) for (const r of t.regulatory_basis) covered.add(r);
  const uncovered: CoverageGap[] = regulations
    .filter((r) => !covered.has(r.id))
    .map((r) => ({
      id: r.id,
      citation: r.citation,
      is_leaf: !r.children.some((c) => c.startsWith("regulation://")),
    }));
  return {
    total_regulations: regulations.length,
    covered: regulations.length - uncovered.length,
    uncovered,
  };
}

// Shared input value for the traversal tools' verbosity switch.
const detailSchema = z
  .enum(["concise", "full"])
  .default("concise")
  .describe(
    "concise (default): resolved references become { type, id, label } stubs " +
      "(label = citation for regulation, name otherwise; null when unresolved); " +
      "full: complete records embedded.",
  );

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "get_corpus_info",
    {
      title: "Corpus info",
      description:
        "What's loaded right now — the entry point before anything else. " +
        "Returns { last_updated, counts: {regulation, test, check, playbook, source}, " +
        "coverage: [...], stale_sources: [...] } — stale_sources lists current sources " +
        "whose verified date is older than 30 days; follow up with list_sources, then " +
        "list_review_areas to map a task onto the corpus.",
      inputSchema: {},
      outputSchema: CorpusInfoSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async () => ok(await adapters.meta.info()),
  );

  server.registerTool(
    "get_referrers",
    {
      title: "Find referrers",
      description:
        "The computed reverse index: everything that references this ID through a typed " +
        "cross-surface reference (parent/children, derived_from, regulatory_basis, " +
        "regulatory_scope, playbook phase references). Returns { regulation, tests, checks, " +
        "playbooks, primary: { tests, checks } }, where `primary` is the subset naming this " +
        "provision as the one it RESTATES rather than the span it was traced to — " +
        "derived_from is commonly a whole section, so the flat lists can return the same " +
        "answer for every article in it. Prefer `primary` when it is non-empty. Accepts " +
        "regulation://, test://, " +
        "check://, playbook:// ids — source:// ids error (sources sit outside the reference " +
        "graph; they join via document_id). Resolve returned ids with the matching get_* tool.",
      inputSchema: {
        id: z.string().describe("Any content-surface ID — regulation://, test://, check://, or playbook://."),
      },
      outputSchema: ReferrersSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id }) => {
      const cleaned = stripEdgeNoise(id);
      if (!anyIdSchema.safeParse(cleaned).success) {
        if (cleaned.startsWith("source://")) {
          return miss(
            `${cleaned} is a source-registry id. Sources sit outside the reference graph — ` +
              "they join regulation records via framework + document_id, never by URI — so " +
              "nothing refers to them by id. Use get_source or list_sources instead.",
          );
        }
        return miss(
          `'${id}' is not a corpus URI. Pass a regulation://, test://, check://, or ` +
            "playbook:// id — find one with the search_* tools or list_review_areas.",
        );
      }
      return ok(await adapters.meta.referrers(cleaned));
    },
  );

  server.registerTool(
    "resolve_citation",
    {
      title: "Resolve citation",
      description:
        "Loose citation string in prose (\"Art. 178(1)(a)\", \"Chapter 5, paragraph 12\", " +
        "\"EBA GL 2017/16 para 78\") → the Regulation record it names, or an honest refusal.\n" +
        "Matching is EXACT, in this order: the record's own citation, then its numeric spine " +
        "(article/paragraph/point numbers) scoped to the document the citation names. There is " +
        "no fuzzy fallback — 1218 is not 121, and a citation naming an instrument this corpus " +
        "does not hold resolves to null rather than to a same-numbered provision elsewhere.\n" +
        "Returns { match, confidence, candidates, ambiguous, unmatched_segments, coverage_note }:\n" +
        "  match null + candidates non-empty → several records fit (ambiguous: true) or the " +
        "corpus holds only narrower provisions under the one asked for; open a candidate by id.\n" +
        "  match null + coverage_note → why, in terms of what this corpus covers.\n" +
        "  confidence 'exact' | 'segment' says which rule matched.\n" +
        "Do not present a null match as a citation. Fall back to search_regulation with the " +
        "citation's key words, or get_corpus_info for the documents actually loaded.",
      inputSchema: {
        text: z.string().describe("A loose, human-prose citation."),
      },
      outputSchema: CitationResolutionSchema.passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ text }) => ok(await adapters.meta.resolveCitation(text)),
  );

  server.registerTool(
    "list_review_areas",
    {
      title: "List review areas",
      description:
        // "START HERE", plus an example phrased as the user's own question,
        // made this the default first call for anything that sounded like a
        // review task — and an area is only as wide as the playbooks that
        // minted it, so the funnel ended in one document's table of contents
        // with no signal that the rest of the corpus existed. The tool is still
        // the right entry for a whole-area walkthrough; it is not the right
        // entry for a specific question.
        "The taxonomy of review areas — the entry point when the task is a WHOLE AREA and you want its " +
        "playbooks, checks and regulation in one bundle: take an area id from here to get_area_overview. " +
        "For a specific question, search the surfaces directly instead; an area is derived from the " +
        "playbooks a backend authored, so it reflects how the corpus was written up rather than everything " +
        "the corpus holds on a subject, and it may draw on fewer documents than the corpus covers. " +
        "Returns { areas: [{ id, name, parent, children }] }; ids are dotted slugs and a " +
        "child id is prefixed by its parent's. Backends that author no taxonomy get one " +
        "derived from the playbooks present, so this is never empty for a corpus that has " +
        "any.",
      inputSchema: {},
      outputSchema: z.object({ areas: z.array(ReviewAreaSchema) }).passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async () => ok({ areas: await adapters.meta.taxonomy() }),
  );

  server.registerTool(
    "expand_playbook",
    {
      title: "Expand playbook",
      description:
        "Fetch a playbook with all Phase.references resolved inline — avoids N+1 fetches. " +
        "concise (default): each reference becomes a { type, id, label } stub; detail: 'full' " +
        "embeds the complete Regulation | Test | Check | Playbook record per reference " +
        "(record null if unresolved). Unknown ids return isError with a pointer — verify " +
        "with search_playbooks or list_review_areas.\n" +
        "Use this when you intend to FOLLOW the references. If the question is only what the " +
        "steps are, get_playbook with detail: 'steps' answers it for roughly a fifth of the " +
        "payload — a dense playbook resolves to ~90 stubs plus a regulatory_scope of a couple " +
        "of hundred ids, none of which is the walkthrough.",
      inputSchema: {
        id: lenient(playbookIdSchema).describe(
          "A playbook id from search_playbooks, list_review_areas or get_area_overview — shape playbook://{document}/{slug}",
        ),
        detail: detailSchema,
      },
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, detail }) => {
      const raw = await adapters.playbook.get(id);
      if (raw === null) return miss(`No playbook ${id}. Verify the id with search_playbooks or list_review_areas.`);
      const expanded = await expandPlaybook(raw);
      return ok(detail === "full" ? expanded : toConcisePlaybook(expanded));
    },
  );

  server.registerTool(
    "get_area_overview",
    {
      title: "Area overview",
      description:
        "One-shot entry point for a review area — prefer this over several search_* calls " +
        "when the question is about a whole area.\n" +
        "Returns { area, playbooks, regulation_ids, check_ids, test_ids, playbook_ids }. " +
        "By default each playbook is a walkthrough SUMMARY: phase names, descriptions and " +
        "per-phase reference counts. The references themselves arrive de-duplicated in the " +
        "flat id lists below, so nothing is missing — expand_playbook gives the per-phase " +
        "breakdown when the phase a reference belongs to actually matters. " +
        "detail: 'full' embeds every referenced record inline and is large; ask for it only " +
        "when the whole area is being read.\n" +
        "playbook_ids are playbooks referenced but not already listed, which is how a " +
        "lifecycle playbook names the per-parameter ones. Asking for a top-level area " +
        "includes everything in its subareas. Accepts the slug from list_review_areas " +
        "('pd-estimation') or the area name as spelled on a playbook ('PD Estimation'). " +
        "Unknown areas return isError — call list_review_areas for the canonical list.",
      inputSchema: {
        area: lenient(z.string()).describe(
          "Area slug or name, e.g. 'pd-estimation' or 'PD Estimation'",
        ),
        detail: detailSchema,
      },
      annotations: READ_ONLY_HINTS,
    },
    async ({ area, detail }) => {
      const allAreas = await adapters.meta.taxonomy();
      // Resolution and the playbook filter both go through src/areas.ts, so a
      // slug and the prose it was derived from can never disagree. This filter
      // used to compare `p.area === area` — a slug against free-form prose —
      // which could not match whatever the taxonomy contained.
      const areaNode = resolveArea(allAreas, area);
      if (areaNode === undefined) {
        return miss(
          `Unknown review area '${area}'. Call list_review_areas for the canonical list — ` +
            "it accepts either a slug or an area name as spelled on a playbook.",
        );
      }

      const allPlaybooks = await adapters.playbook.list();
      const areaPlaybooks = allPlaybooks.filter((p) => playbookInArea(p, areaNode));
      const expanded = await Promise.all(areaPlaybooks.map(expandPlaybook));

      const seenReg = new Set<RegulationId>();
      const seenCheck = new Set<CheckId>();
      const seenTest = new Set<TestId>();
      // The area's own playbooks are already in `playbooks`; only referenced
      // ones are worth listing, so they seed the seen-set rather than the list.
      const seenPlaybook = new Set<PlaybookId>(areaPlaybooks.map((p) => p.id));
      const regulation_ids: RegulationId[] = [];
      const check_ids: CheckId[] = [];
      const test_ids: TestId[] = [];
      const playbook_ids: PlaybookId[] = [];

      for (const pb of expanded) {
        for (const ph of pb.phases) {
          for (const ref of ph.references) {
            if (ref.type === "regulation" && !seenReg.has(ref.id)) { seenReg.add(ref.id); regulation_ids.push(ref.id); }
            if (ref.type === "check" && !seenCheck.has(ref.id)) { seenCheck.add(ref.id); check_ids.push(ref.id); }
            if (ref.type === "test" && !seenTest.has(ref.id)) { seenTest.add(ref.id); test_ids.push(ref.id); }
            if (ref.type === "playbook" && !seenPlaybook.has(ref.id)) { seenPlaybook.add(ref.id); playbook_ids.push(ref.id); }
          }
        }
      }
      // Default is the summary, not the stub list. Every reference stub in a
      // phase is also an entry in the flat id lists below, so serving both put
      // each id in the response twice — and the stub wrapper costs about twice
      // what the id does. On a real area that duplication was 73% of the whole
      // payload, which is a fifth of a working context spent restating what the
      // same response already said.
      const rest = { area: areaNode, regulation_ids, check_ids, test_ids, playbook_ids };
      if (detail !== "full") {
        return ok({ ...rest, playbooks: expanded.map(toPlaybookWalkthrough) } satisfies AreaOverview);
      }
      return ok(
        fitOrCompact(
          { ...rest, playbooks: expanded } satisfies AreaOverview,
          () => ({ ...rest, playbooks: expanded.map(toPlaybookWalkthrough) } satisfies AreaOverview),
          (tokens) =>
            `detail: 'full' for this area is ~${tokens} tokens, over the per-response ceiling, ` +
            "so the walkthrough summary is served instead. The complete records are reachable " +
            "per id: expand_playbook for one playbook's references, or get_regulation / " +
            "get_check / get_test for the ids listed here.",
        ),
      );
    },
  );

  server.registerTool(
    "expand_regulation",
    {
      title: "Expand regulation",
      description:
        "Fetch a regulation with its children resolved inline — sub-regulations plus the " +
        "checks/tests that operationalize it; the reverse-direction companion to " +
        "expand_playbook. Returns the regulation fields plus children as { type, id, label } " +
        "stubs (default) or complete records (detail: 'full'). Supports as_of like " +
        "get_regulation. Unknown ids return isError with a pointer. Use get_regulation_tree " +
        "to walk the whole sub-tree.",
      inputSchema: {
        id: lenient(regulationIdSchema).describe(
          "A regulation id from search_regulation or resolve_citation — shape regulation://{document}/{provision}",
        ),
        as_of: z.string().date().optional().describe("ISO date — resolve the regulation as of this date"),
        detail: detailSchema,
      },
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, as_of, detail }) => {
      const raw = await adapters.regulation.get(id, as_of);
      if (raw === null) {
        if (as_of !== undefined && (await adapters.regulation.get(id)) !== null) {
          return miss(
            `No version of ${id} was in force on ${as_of} according to this corpus's history — ` +
              "an as_of predating every recorded version returns nothing. Retry without as_of " +
              "for the current text.",
          );
        }
        return miss(`No record for ${id}. Verify the id with search_regulation or list_review_areas.`);
      }
      const expanded = await expandRegulation(raw);
      return ok(detail === "full" ? expanded : toConciseRegulation(expanded));
    },
  );

  server.registerTool(
    "get_regulation_tree",
    {
      title: "Regulation tree",
      description:
        "Walk a regulation's children recursively into a dossier: the branch of law " +
        "(section → paragraphs) with the checks/tests that operationalize each node attached " +
        "as leaves. Returns a tree of { type, id, citation, children } nodes — concise " +
        "(default) keeps citations and leaf labels only; detail: 'full' embeds each node's " +
        "complete record. depth defaults to 5 and the walk is capped at 200 total nodes; " +
        "nodes cut off by depth, a cycle, or the cap carry truncated: true. Unknown roots " +
        "return isError — verify with search_regulation.",
      inputSchema: {
        id: lenient(regulationIdSchema).describe(
          "Root of the tree: a regulation id from search_regulation — shape regulation://{document}/{provision}",
        ),
        depth: z.number().int().min(0).max(10).optional().describe("Max regulation recursion depth (default 5)"),
        as_of: z.string().date().optional().describe("ISO date — resolve regulations as of this date"),
        detail: detailSchema,
      },
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, depth, as_of, detail }) => {
      const node = await buildRegulationTree(id, depth ?? 5, new Set<RegulationId>(), as_of);
      if (node.record === null) {
        if (as_of !== undefined && (await adapters.regulation.get(id)) !== null) {
          return miss(
            `No version of ${id} was in force on ${as_of} according to this corpus's history. ` +
              "Retry without as_of for the current tree.",
          );
        }
        return miss(`No record for ${id}. Verify the id with search_regulation or list_review_areas.`);
      }
      return ok(detail === "full" ? node : toConciseTree(node));
    },
  );

  server.registerTool(
    "get_coverage_gaps",
    {
      title: "Coverage gaps",
      description:
        "Audit the corpus for regulatory requirements with no validation coverage: regulations " +
        "that no check (derived_from) or test (regulatory_basis) points at. Returns " +
        "{ total_regulations, covered, uncovered: [{ id, citation, is_leaf }] }. is_leaf flags " +
        "whether the gap is a leaf paragraph (a real gap) versus a section that may inherit " +
        "coverage from its children. The aggregate inverse of get_referrers — follow up with " +
        "get_regulation on any uncovered id.",
      inputSchema: {},
      outputSchema: z
        .object({
          total_regulations: z.number().int(),
          covered: z.number().int(),
          uncovered: z.array(
            z.object({ id: regulationIdSchema, citation: z.string(), is_leaf: z.boolean() }),
          ),
        })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async () => {
      const [regs, checks, tests] = await Promise.all([
        adapters.regulation.list(),
        adapters.check.list(),
        adapters.test.list(),
      ]);
      return ok(computeCoverageGaps(regs, checks, tests));
    },
  );
}
