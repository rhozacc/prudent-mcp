/**
 * Cross-cutting tools — operate across all four surfaces.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
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
import { playbookIdSchema } from "../schema.ts";

// ── Local return types ────────────────────────────────────────────────────────

type ResolvedReference =
  | { type: "regulation"; id: RegulationId; record: Regulation | null }
  | { type: "test";       id: TestId;       record: Test | null }
  | { type: "check";      id: CheckId;      record: Check | null }
  | { type: "playbook";   id: PlaybookId;   record: Playbook | null };

type ExpandedPhase = { name: string; description: string; references: ResolvedReference[] };

type ExpandedPlaybook = {
  id: PlaybookId;
  area: string;
  subarea?: string;
  phases: ExpandedPhase[];
  gates: string[];
  last_updated: string;
};

type AreaOverview = {
  area: ReviewArea;
  playbooks: ExpandedPlaybook[];
  regulation_ids: RegulationId[];
  check_ids: CheckId[];
  test_ids: TestId[];
};

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

// ── Utility ───────────────────────────────────────────────────────────────────

function asJson(value: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "get_corpus_info",
    {
      description:
        "What's loaded right now. Tells Claude what's actually queryable. " +
        "Returns { last_updated, counts: {regulation, test, check, playbook}, coverage: [...] }.",
      inputSchema: {},
    },
    async () => asJson(await adapters.meta.info()),
  );

  server.registerTool(
    "get_referrers",
    {
      description:
        "Find everything that references this ID. Works on any surface. " +
        "Returns { regulation: [...], tests: [...], checks: [...], playbooks: [...] }.",
      inputSchema: {
        id: z.string().describe("Any surface ID — regulation://, test://, check://, or playbook://."),
      },
    },
    async ({ id }) => asJson(await adapters.meta.referrers(id)),
  );

  server.registerTool(
    "resolve_citation",
    {
      description:
        "Loose citation string → structured Regulation.\n" +
        '"Art. 178(1)(a)"            → regulation://crr/178/1/a\n' +
        '"CRR Article 178"           → regulation://crr/178\n' +
        '"EBA GL on PD-LGD, para 83" → regulation://eba/gl-2017-16/83',
      inputSchema: {
        text: z.string().describe("A loose, human-prose citation."),
      },
    },
    async ({ text }) => asJson(await adapters.meta.resolveCitation(text)),
  );

  server.registerTool(
    "list_review_areas",
    {
      description:
        "The canonical taxonomy of review areas. Use this to map a real-world task " +
        "('I'm reviewing LGD calibration') onto the corpus's structure. Without this, " +
        "every review invents its own mapping from doc sections to corpus content.",
      inputSchema: {},
    },
    async () => asJson(await adapters.meta.taxonomy()),
  );

  server.registerTool(
    "expand_playbook",
    {
      description:
        "Fetch a playbook with all Phase.references resolved inline — avoids N+1 fetches. " +
        "Returns ExpandedPlaybook | null. Each reference becomes { type, id, record } where " +
        "record is the full Regulation | Test | Check | Playbook object (null if not found).",
      inputSchema: { id: playbookIdSchema },
    },
    async ({ id }) => {
      const raw = await adapters.playbook.get(id);
      return asJson(raw === null ? null : await expandPlaybook(raw));
    },
  );

  server.registerTool(
    "get_area_overview",
    {
      description:
        "One-shot entry point for a review area. Returns the ReviewArea node, all its playbooks " +
        "fully expanded, and deduplicated flat lists of regulation_ids, check_ids, test_ids " +
        "encountered across all phases. Returns null if the area slug is unknown. " +
        "Use list_review_areas first to confirm the canonical slug.",
      inputSchema: { area: z.string().describe("Canonical area slug, e.g. 'calibration.pd'") },
    },
    async ({ area }) => {
      const allAreas = await adapters.meta.taxonomy();
      const areaNode = allAreas.find((a) => a.id === area);
      if (areaNode === undefined) return asJson(null);

      const allPlaybooks = await adapters.playbook.search("");
      const areaPlaybooks = allPlaybooks.filter(
        (p) => p.area === area || (p.subarea !== undefined && `${p.area}.${p.subarea}` === area),
      );
      const expanded = await Promise.all(areaPlaybooks.map(expandPlaybook));

      const seenReg = new Set<RegulationId>();
      const seenCheck = new Set<CheckId>();
      const seenTest = new Set<TestId>();
      const regulation_ids: RegulationId[] = [];
      const check_ids: CheckId[] = [];
      const test_ids: TestId[] = [];

      for (const pb of expanded) {
        for (const ph of pb.phases) {
          for (const ref of ph.references) {
            if (ref.type === "regulation" && !seenReg.has(ref.id)) { seenReg.add(ref.id); regulation_ids.push(ref.id); }
            if (ref.type === "check" && !seenCheck.has(ref.id)) { seenCheck.add(ref.id); check_ids.push(ref.id); }
            if (ref.type === "test" && !seenTest.has(ref.id)) { seenTest.add(ref.id); test_ids.push(ref.id); }
          }
        }
      }
      return asJson({ area: areaNode, playbooks: expanded, regulation_ids, check_ids, test_ids } satisfies AreaOverview);
    },
  );
}
