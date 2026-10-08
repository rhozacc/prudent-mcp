/**
 * What the playbook renderer and verifier read: the provisions, checks, tests, sources and other playbooks a
 * playbook's ids refer to. Plain maps, so both are pure functions of their arguments and the factory can run them
 * over a corpus file with no server in between.
 */
import type {
  Check,
  CheckId,
  Playbook,
  PlaybookId,
  PlaybookStatus,
  Regulation,
  RegulationId,
  Source,
  Test,
  TestId,
} from "./schema.ts";

export interface PlaybookContext {
  regulations: ReadonlyMap<RegulationId, Regulation>;
  sources: readonly Source[];
  checks?: ReadonlyMap<CheckId, Check>;
  tests?: ReadonlyMap<TestId, Test>;
  /** The other playbooks, for `related`: what resolves, what it is called and whether it is approved. */
  playbooks?: ReadonlyMap<PlaybookId, { title: string; status?: PlaybookStatus }>;
}

export interface PlaybookContextParts {
  regulations: readonly Regulation[];
  sources: readonly Source[];
  checks?: readonly Check[];
  tests?: readonly Test[];
  playbooks?: readonly Pick<Playbook, "id" | "title" | "provenance">[];
}

export function playbookContext(parts: PlaybookContextParts): PlaybookContext {
  return {
    regulations: new Map(parts.regulations.map((r) => [r.id, r])),
    sources: parts.sources,
    ...(parts.checks === undefined ? {} : { checks: new Map(parts.checks.map((c) => [c.id, c])) }),
    ...(parts.tests === undefined ? {} : { tests: new Map(parts.tests.map((t) => [t.id, t])) }),
    ...(parts.playbooks === undefined
      ? {}
      : { playbooks: new Map(parts.playbooks.map((p) => [p.id, { title: p.title, status: p.provenance.status }])) }),
  };
}

/** The same rough count the evals use for tokens: a character is a quarter of one. */
export const approxTokens = (text: string): number => Math.round(text.length / 4);

export const wordCount = (text: string): number => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);
