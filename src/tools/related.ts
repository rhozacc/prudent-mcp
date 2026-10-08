/**
 * `related`: what sits around a provision (or a check, test or playbook).
 *
 * For a provision: where it is (document, heading path), the provisions beside it, what it cites and what cites it,
 * the checks and tests that restate it (the ones that name it as their primary basis first), the playbooks that rely
 * on it and the amendments that affect it. Nothing is inferred: every link is an id the library already holds.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { crossRefs } from "../crossrefs.ts";
import { computeHoldings } from "../holdings.ts";
import { playbookProvisions } from "../referrers.ts";
import type { Playbook, Regulation, RegulationId } from "../schema.ts";
import { notesShape, officialCitation, provisionNotes, withNotes } from "./notes.ts";
import { READ_ONLY_HINTS, miss, ok, resolveRegulation, stripEdgeNoise, unknownRegulationMiss } from "./shared.ts";

const MAX_SIBLINGS = 12;
const MAX_LINKS = 10;

const ref = async (r: Regulation) => ({ id: r.id, citation: await officialCitation(r) });

function requirementsCiting(p: Playbook, id: RegulationId): string[] {
  return p.requirements.filter((r) => r.provisions.some((x) => x.id === id)).map((r) => r.id);
}

export function registerRelatedTool(server: McpServer): void {
  server.registerTool(
    "related",
    {
      title: "Related",
      description:
        "What surrounds an entry. For a provision: its document and heading path, the provisions beside it, what it cites and what cites it, " +
        "the checks and tests that restate it, the playbooks that rely on it, and amendments that affect it (as notes). " +
        "For a check or test: the provisions it rests on and the playbooks that use it. For a playbook: the playbooks it points to.",
      inputSchema: {
        id: z.string().describe("A provision, check, test or playbook id."),
        as_of: z.string().date().optional().describe("ISO date: amendments are read as of this day. Provisions only."),
      },
      outputSchema: z
        .object({
          id: z.string(),
          citation: z.string().optional(),
          document_id: z.string().optional(),
          heading_path: z.array(z.string()).optional(),
          parent: z.object({ id: z.string(), citation: z.string() }).optional(),
          siblings: z.array(z.object({ id: z.string(), citation: z.string() })).optional(),
          cites: z.array(z.object({ id: z.string(), citation: z.string() })).optional(),
          cited_by: z.array(z.object({ id: z.string(), citation: z.string() })).optional(),
          checks: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
          tests: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
          playbooks: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
          ...notesShape,
        })
        .passthrough(),
      annotations: READ_ONLY_HINTS,
    },
    async ({ id: raw, as_of }) => {
      const id = stripEdgeNoise(raw);

      if (id.startsWith("regulation://")) {
        const { record } = await resolveRegulation(id as RegulationId, as_of);
        const current = record ?? (await adapters.regulation.get(id as RegulationId));
        if (current === null) return unknownRegulationMiss(id);
        const [regulations, sources, playbooks, referrers] = await Promise.all([
          adapters.regulation.list(),
          adapters.source.list(),
          adapters.playbook.list(),
          adapters.meta.referrers(id),
        ]);
        const byId = new Map(regulations.map((r) => [r.id as string, r] as const));
        const refs = crossRefs(regulations, computeHoldings(regulations, sources));
        const parent = current.parent === undefined ? undefined : byId.get(current.parent);
        const heading = (current.heading_path ?? []).join(" > ");
        const siblings = regulations
          .filter((r) => r.id !== current.id && r.kind !== "section" && (parent !== undefined ? r.parent === parent.id : heading !== "" && (r.heading_path ?? []).join(" > ") === heading))
          .slice(0, MAX_SIBLINGS);
        const linked = async (ids: readonly string[] | undefined) => Promise.all((ids ?? []).map((x) => byId.get(x)).filter((r): r is Regulation => r !== undefined).slice(0, MAX_LINKS).map(ref));
        const checks = referrers.primary.checks.length > 0 ? referrers.primary.checks : referrers.checks;
        const tests = referrers.primary.tests.length > 0 ? referrers.primary.tests : referrers.tests;
        const named = async (kind: "check" | "test", ids: string[]) =>
          (await Promise.all(ids.slice(0, MAX_LINKS).map((x) => (kind === "check" ? adapters.check.get(x as never) : adapters.test.get(x as never))))).flatMap((r) => (r === null ? [] : [{ id: r.id, name: r.name }]));
        const citing = playbooks.filter((p) => playbookProvisions(p).has(current.id));
        const body = {
          id: current.id,
          citation: await officialCitation(current, sources),
          document_id: current.document_id,
          ...(current.heading_path !== undefined && current.heading_path.length > 0 ? { heading_path: current.heading_path } : {}),
          ...(parent === undefined ? {} : { parent: await ref(parent) }),
          siblings: await Promise.all(siblings.map(ref)),
          cites: await linked(refs.cites.get(current.id)),
          cited_by: await linked(refs.citedBy.get(current.id)),
          checks: await named("check", checks),
          tests: await named("test", tests),
          playbooks: citing.map((p) => ({ id: p.id, title: p.title, requirements: requirementsCiting(p, current.id) })),
        };
        return ok(withNotes(body, await provisionNotes(current, { asOf: as_of })));
      }

      if (id.startsWith("check://") || id.startsWith("test://")) {
        const isCheck = id.startsWith("check://");
        const entry = isCheck ? await adapters.check.get(id as never) : await adapters.test.get(id as never);
        if (entry === null) return miss(`This library holds no entry with the id ${id}. Find one with search (scope: ${isCheck ? "checks" : "tests"}).`);
        const basis = isCheck ? (entry as { derived_from: RegulationId[] }).derived_from : (entry as { regulatory_basis: RegulationId[] }).regulatory_basis;
        const primary = (entry as { primary_basis?: RegulationId[] }).primary_basis;
        const regs = await Promise.all((primary !== undefined && primary.length > 0 ? primary : basis).slice(0, MAX_LINKS).map((x) => adapters.regulation.get(x)));
        const playbooks = (await adapters.playbook.list()).filter((p) => p.requirements.some((r) => (isCheck ? r.checks : r.tests).includes(id as never)));
        return ok({
          id,
          name: entry.name,
          rests_on: await Promise.all(regs.flatMap((r) => (r === null ? [] : [ref(r)]))),
          playbooks: playbooks.map((p) => ({ id: p.id, title: p.title })),
        });
      }

      if (id.startsWith("playbook://")) {
        const p = await adapters.playbook.get(id as never);
        if (p === null) return miss(`This library holds no playbook with the id ${id}. topics lists them.`);
        const all = await adapters.playbook.list();
        const titleOf = new Map(all.map((x) => [x.id as string, x.title] as const));
        return ok({ id: p.id, title: p.title, related: p.related.filter((x) => titleOf.has(x)).map((x) => ({ id: x, title: titleOf.get(x) })) });
      }

      return miss(`'${raw}' is not an id this library uses. Pass a regulation://, check://, test:// or playbook:// id (search and brief return them).`);
    },
  );
}
