#!/usr/bin/env node
/**
 * In-memory adapter implementation for development and inspection.
 *
 * Seeds prudent-mcp with a coherent slice of PD-calibration content (plus a
 * default-definition aside) so the server can be exercised end to end
 * without an external backend.
 *
 *   bun install
 *   bun run demo                             # starts the server on stdio
 *   bun run inspect:demo                     # opens the MCP Inspector
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { adapters } from "../src/adapters.ts";
import type {
  AsOfResolution,
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  SourceAdapter,
  TestAdapter,
} from "../src/adapters.ts";
import { resolveCitationDetailed } from "../src/file-adapter.ts";
import { computeHoldings } from "../src/holdings.ts";
import { pendingChangeSummaries } from "../src/pending.ts";
import { playbookContext, type PlaybookContext } from "../src/playbook-context.ts";
import { computeReferrers } from "../src/referrers.ts";
import {
  checkSearchFields,
  playbookSearchFields,
  rankedSearch,
  regulationSearchFields,
  testSearchFields,
} from "../src/search.ts";
import type {
  Check,
  CheckId,
  CompiledPlaybook,
  Playbook,
  PlaybookId,
  Regulation,
  RegulationId,
  ReviewArea,
  Source,
  SourceId,
  Test,
  TestId,
  Topics,
} from "../src/schema.ts";
import { createServer } from "../src/server.ts";
import { staleSourceIds } from "../src/validate.ts";

// ============================================================================
// Seed data — one cohesive slice (PD calibration + default definition aside)
// ============================================================================

// Source registry seeds. Unlike the frozen dates elsewhere in this file,
// `verified` is computed relative to today so the demo permanently shows
// exactly one stale source (the eba/gl-2017-16 seed) instead of every seed
// rotting past the 30-day line as time passes.
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const REGULATIONS: Record<RegulationId, Regulation> = {
  "regulation://crr/180": {
    id: "regulation://crr/180",
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 180",
    text:
      "Sets the requirements for institution-specific estimates of PD under the IRB Approach. " +
      "PDs shall be estimated per obligor grade and be supported by sufficient historical " +
      "experience and empirical evidence.",
    commentary: [],
    // Mixed children: a sub-paragraph plus a check that operationalizes the article.
    children: ["regulation://crr/180/1/a", "check://calibration/pd/segment-tested"],
  },
  "regulation://crr/180/1/a": {
    id: "regulation://crr/180/1/a",
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 180(1)(a)",
    text:
      "Institutions shall estimate PDs by obligor grade from long-run averages of " +
      "one-year default rates.",
    commentary: [
      {
        source: "EBA Q&A 2018_3804",
        text:
          "The 'long-run' period should encompass at least one full economic cycle, " +
          "with a minimum of five years of historical data and longer periods where " +
          "the available history is not representative.",
        last_updated: "2018-11-09",
      },
    ],
    parent: "regulation://crr/180",
    children: ["check://calibration/pd/lra-derived"],
  },
  "regulation://eba/gl-2017-16/s4": {
    id: "regulation://eba/gl-2017-16/s4",
    framework: "eba",
    document_id: "eba-gl-2017-16",
    document_version: "2017-11-20",
    citation: "EBA GL 2017/16 Section 4 — Requirements related to PD estimation",
    text:
      "This section sets out the requirements for PD estimation under the IRB Approach, " +
      "covering reference data sets, observation periods, and calibration methodology.",
    commentary: [],
    children: ["regulation://eba/gl-2017-16/78"],
  },
  "regulation://eba/gl-2017-16/78": {
    id: "regulation://eba/gl-2017-16/78",
    framework: "eba",
    document_id: "eba-gl-2017-16",
    document_version: "2017-11-20",
    citation: "EBA GL 2017/16 paragraph 78",
    text:
      "When calibrating PDs, institutions should ensure that the long-run average default " +
      "rate used as the calibration target reflects the likely range of variability of " +
      "one-year default rates, including downturn periods relevant to the portfolio.",
    commentary: [],
    parent: "regulation://eba/gl-2017-16/s4",
    children: ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"],
  },
  "regulation://crr/178/1/a": {
    id: "regulation://crr/178/1/a",
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 178(1)(a)",
    text:
      "A default shall be considered to have occurred when the institution considers " +
      "that the obligor is unlikely to pay its credit obligations in full to the " +
      "institution, the parent undertaking or any of its subsidiaries, without recourse " +
      "by the institution to actions such as realising security.",
    commentary: [
      {
        source: "EBA GL 2016/07 para 47",
        text:
          "Institutions should use objective indicators of unlikeliness to pay, " +
          "including: the institution placing the obligation on non-accrued status, " +
          "recognition of a credit-impairment or specific credit adjustment, sale of " +
          "the credit obligation at a material credit-related economic loss, distressed " +
          "restructuring, bankruptcy or similar protection, and any other indication " +
          "deemed relevant by the institution. Each indicator should be documented and " +
          "applied consistently across all portfolios.",
        last_updated: "2016-09-28",
      },
    ],
    children: [],
  },
  "regulation://crr/178/1/b": {
    id: "regulation://crr/178/1/b",
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 178(1)(b)",
    text:
      "A default shall be considered to have occurred when the obligor is past due " +
      "more than 90 days on any material credit obligation, with materiality assessed " +
      "against thresholds set in the relevant Commission Delegated Regulation.",
    commentary: [],
    children: [],
  },
  // A provision of the instrument that amends the CRR record above, held in the demo so
  // that the amendment is pinned to the provision it changes and not to the document:
  // 178(1)(a) is noted, and 178(1)(b) and Article 180 (same document) are not (eval I15).
  // Its wording is invented for the demo.
  "regulation://crr-amending-demo/art-1": {
    id: "regulation://crr-amending-demo/art-1",
    framework: "crr",
    document_id: "crr-amending-demo",
    document_version: daysAgo(10),
    citation: "Article 1",
    text:
      "Article 178(1)(a) is replaced by the following: a default shall be considered to have " +
      "occurred when the institution considers that the obligor is unlikely to pay its credit " +
      "obligations in full, whether or not security is realised.",
    commentary: [],
    amends: [{ target: "regulation://crr/178/1/a", op: "replace", effective_from: daysAgo(-60) }],
    children: [],
  },
};

// Historical regulation versions, ordered by effective_from ascending.
const HISTORICAL_REGULATIONS: Partial<Record<RegulationId, Array<{ effectiveFrom: string; reg: Regulation }>>> = {
  "regulation://crr/178/1/b": [
    {
      effectiveFrom: "2014-01-01",
      reg: {
        id: "regulation://crr/178/1/b",
        framework: "crr",
        document_id: "crr",
        document_version: "2013-06-26",
        citation: "CRR Article 178(1)(b)",
        text:
          "A default shall be considered to have occurred when the obligor is past " +
          "due more than 90 days on any material credit obligation. Materiality is " +
          "left to national competent authority discretion.",
        commentary: [],
        children: [],
      },
    },
    {
      effectiveFrom: "2021-06-28",
      reg: REGULATIONS["regulation://crr/178/1/b"]!,
    },
  ],
};

const TESTS: Record<TestId, Test> = {
  "test://jeffreys": {
    id: "test://jeffreys",
    name: "Jeffreys test",
    aliases: ["one-sided Jeffreys", "Bayesian PD test"],
    family: "calibration-binomial",
    purpose:
      "Bayesian test for PD calibration at the rating grade or pool level. Compares " +
      "observed default rate against the PD estimate using a Jeffreys prior on the " +
      "default probability.",
    acceptance_criteria:
      "Posterior probability that the true PD exceeds the estimate is below the " +
      "chosen significance level (typically one-sided 95%).",
    regulatory_basis: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    parent: "regulation://eba/gl-2017-16/78",
    last_updated: "2024-06-01",
  },
  "test://binomial": {
    id: "test://binomial",
    name: "Binomial test",
    aliases: ["one-sided binomial test", "frequentist PD test"],
    family: "calibration-binomial",
    purpose:
      "Frequentist test for PD calibration at the rating grade or pool level. Tests " +
      "whether the observed number of defaults is consistent with the estimated PD " +
      "under a binomial assumption.",
    acceptance_criteria:
      "p-value > α (typically 0.05 one-sided) indicates calibration is not rejected at the grade.",
    regulatory_basis: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    parent: "regulation://eba/gl-2017-16/78",
    last_updated: "2024-06-01",
  },
  "test://hosmer-lemeshow": {
    id: "test://hosmer-lemeshow",
    name: "Hosmer-Lemeshow test",
    aliases: ["HL test", "HL chi-squared", "modified HL"],
    family: "calibration-grouped",
    purpose:
      "Goodness-of-fit test that groups predictions into buckets (typically deciles) " +
      "and compares observed vs predicted defaults across groups.",
    acceptance_criteria:
      "Chi-squared statistic with g-2 degrees of freedom (g = number of groups). " +
      "p-value > α (typically 0.05) indicates calibration is not rejected at portfolio level.",
    regulatory_basis: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    parent: "regulation://eba/gl-2017-16/78",
    last_updated: "2024-06-01",
  },
};

const CHECKS: Record<CheckId, Check> = {
  "check://calibration/pd/lra-derived": {
    id: "check://calibration/pd/lra-derived",
    name: "PD long-run average derived from sufficient history",
    derived_from: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    parent: "regulation://crr/180/1/a",
    expectation:
      "PD long-run average is computed over a period containing at least one full " +
      "economic cycle, with a minimum of five years of default data. Where recent " +
      "observations are not representative of long-term performance, longer periods " +
      "or downturn-adjusted estimates are used and the choice is documented.",
    expected_evidence: [
      "default rate time series with vintage, date, and default flag per observation",
      "economic cycle identification and justification of period length",
      "reconciliation of historical default definition to currently applied definition",
    ],
    last_updated: "2024-09-01",
  },
  "check://calibration/pd/segment-tested": {
    id: "check://calibration/pd/segment-tested",
    name: "PD calibration tested per grade or pool",
    derived_from: ["regulation://crr/180"],
    parent: "regulation://crr/180",
    expectation:
      "Calibration tests are performed at the level at which PDs are assigned " +
      "(rating grade or pool), not solely at portfolio level. Materially different " +
      "segments are tested separately and findings are documented per segment.",
    expected_evidence: [
      "per-grade or per-pool default counts and PD estimates for each test period",
      "test statistics and p-values per material grade or pool",
      "list of segments tested separately with materiality justification",
    ],
    last_updated: "2024-09-01",
  },
  "check://default-definition/90dpd": {
    id: "check://default-definition/90dpd",
    name: "Default definition includes 90 DPD backstop",
    derived_from: ["regulation://crr/178/1/b"],
    expectation:
      "The applied default definition includes the 90-days-past-due trigger, with " +
      "materiality thresholds aligned to the relevant RTS and the treatment of " +
      "technical past-dues clearly documented.",
    expected_evidence: [
      "written default definition policy referencing the 90 DPD trigger",
      "materiality threshold values with reference to the applicable RTS",
      "treatment of technical past-dues documented in policy or methodology",
    ],
    last_updated: "2024-09-01",
  },
  "check://default-definition/utp": {
    id: "check://default-definition/utp",
    name: "Default definition includes unlikely-to-pay (UTP) triggers",
    derived_from: ["regulation://crr/178/1/a"],
    expectation:
      "The applied default definition includes at least the mandatory UTP indicators " +
      "from EBA GL 2016/07 (non-accrued status, specific credit adjustment, sale at " +
      "material credit-related economic loss, distressed restructuring, bankruptcy). " +
      "Any additional institution-specific UTP triggers are documented and applied " +
      "consistently across all portfolios and legal entities.",
    expected_evidence: [
      "written default definition policy listing UTP indicators applied",
      "mapping of each mandatory EBA GL 2016/07 indicator to implementation",
      "documentation of any institution-specific UTP triggers and consistency evidence",
    ],
    last_updated: "2024-09-01",
  },
};

const PLAYBOOKS: Record<PlaybookId, Playbook> = {
  "playbook://calibration": {
    id: "playbook://calibration",
    area: "calibration",
    regulatory_scope: [],
    phases: [
      {
        name: "Identify component",
        description:
          "Determine whether the review concerns PD, LGD, or EAD calibration. " +
          "Drop into the relevant sub-playbook.",
        references: [],
      },
    ],
    gates: [],
    last_updated: "2024-10-01",
  },
  "playbook://calibration/pd": {
    id: "playbook://calibration/pd",
    area: "calibration",
    subarea: "pd",
    regulatory_scope: ["regulation://eba/gl-2017-16/s4", "regulation://crr/180"],
    phases: [
      {
        name: "Validate LRA derivation",
        description:
          "Confirm the long-run average period covers a full cycle and that the " +
          "default-rate time series is reconstructed consistently with the currently " +
          "applied default definition.",
        references: [
          "regulation://crr/180/1/a",
          "regulation://eba/gl-2017-16/78",
          "check://calibration/pd/lra-derived",
        ],
      },
      {
        name: "Test calibration at grade level",
        description:
          "Run grade-level calibration tests. Use a binomial-family test (Jeffreys " +
          "or one-sided binomial) per grade; HL or equivalent at portfolio level. " +
          "Bank-specific variants are acceptable if they belong to the same family " +
          "and the acceptance criteria are met.",
        references: [
          "test://jeffreys",
          "test://binomial",
          "test://hosmer-lemeshow",
          "check://calibration/pd/segment-tested",
        ],
      },
      {
        name: "Document interpretation",
        description:
          "Reconcile findings against EBA GL expectations and document any " +
          "deviations from internal calibration policy.",
        references: ["regulation://eba/gl-2017-16/78"],
      },
    ],
    gates: [
      "LRA period covers a full economic cycle",
      "All material grades tested individually",
      "Deviations explained and approved",
    ],
    last_updated: "2024-10-01",
  },
};

const REVIEW_AREAS: ReviewArea[] = [
  { id: "calibration", name: "Calibration", children: ["calibration.pd", "calibration.lgd"] },
  { id: "calibration.pd", name: "PD Calibration", parent: "calibration", children: [] },
  { id: "calibration.lgd", name: "LGD Calibration", parent: "calibration", children: [] },
  { id: "default-definition", name: "Default Definition", children: [] },
  { id: "discriminatory-power", name: "Discriminatory Power", children: [] },
];


const SOURCES: Record<SourceId, Source> = {
  "source://crr/575-2013": {
    id: "source://crr/575-2013",
    title: "Regulation (EU) No 575/2013 (CRR)",
    framework: "crr",
    document_id: "crr",
    doc_type: "regulation",
    status: "current",
    published: "2013-06-26",
    effective_from: "2014-01-01",
    verified: daysAgo(3),
    // The seed holds a handful of articles, so the registry says so: this is
    // what makes a miss on an unseeded article read as absent from the corpus
    // rather than from the law (and what binds eval I12 on the demo).
    coverage: "partial",
    citation_style: { kind: "eu-regulation", short_name: "CRR" },
    // An amendment the registry knows is coming and the seed does not carry. It is
    // dated relative to today, like `verified`, so the demo permanently shows an
    // UPCOMING change instead of one that rots into "in force" (and it is what
    // binds eval I15 on the demo).
    pending_changes: [
      {
        title: "Amending Regulation (demo)",
        status: "adopted",
        effective_from: daysAgo(-60),
        ingested: false,
        affects: ["Article 178"],
        // The same fact as ids, which is what pins the note to the provision it concerns.
        affects_ids: ["regulation://crr/178/1/a"],
      },
    ],
    milestones: [],
    url: "https://eur-lex.europa.eu/eli/reg/2013/575/oj",
  },
  "source://crr/amending-demo": {
    id: "source://crr/amending-demo",
    title: "Amending Regulation (demo)",
    framework: "crr",
    document_id: "crr-amending-demo",
    doc_type: "regulation",
    status: "current",
    published: daysAgo(30),
    effective_from: daysAgo(-60),
    coverage: "full",
    pending_changes: [],
    verified: daysAgo(3),
    milestones: [],
  },
  "source://eba/gl-2017-16": {
    id: "source://eba/gl-2017-16",
    title: "EBA-GL-2017-16 Guidelines on PD estimation, LGD estimation and the treatment of defaulted exposures",
    framework: "eba",
    document_id: "eba-gl-2017-16",
    doc_type: "guideline",
    status: "current",
    published: "2017-11-20",
    effective_from: "2021-01-01",
    coverage: "full",
    citation_style: { kind: "eba-gl", short_name: "EBA/GL/2017/16" },
    // Looked at and nothing pending: `[]` is a statement, an absent key is not.
    pending_changes: [],
    // Deliberately stale — exercises stale_sources and the validate warning.
    verified: daysAgo(45),
    milestones: [],
    url: "https://www.eba.europa.eu/regulation-and-policy/model-validation",
  },
  "source://eba/cp-2016-21": {
    id: "source://eba/cp-2016-21",
    title: "EBA-CP-2016-21 Consultation on PD/LGD estimation guidelines",
    framework: "eba",
    document_id: "eba-cp-2016-21",
    doc_type: "consultation",
    status: "superseded",
    published: "2016-11-14",
    // Old verified date on a superseded record — must NOT count as stale.
    verified: daysAgo(45),
    superseded_by: "source://eba/gl-2017-16",
    milestones: [],
    notes: "Consultation that produced EBA-GL-2017-16; kept for provenance.",
  },
  "source://eba/cp-2025-14": {
    id: "source://eba/cp-2025-14",
    title: "EBA-CP-2025-14 Consultation on amending the PD/LGD estimation guidelines (CRR3 alignment)",
    framework: "eba",
    document_id: "eba-cp-2025-14",
    doc_type: "consultation",
    status: "pending",
    published: "2025-06-30",
    verified: daysAgo(3),
    milestones: [
      { date: "2026-10-19", event: "Consultation closes" },
      { date: "Q2 2027", event: "Final guidelines expected" },
    ],
    url: "https://www.eba.europa.eu/publications-and-media",
  },
  "source://ecb/guide-internal-models": {
    id: "source://ecb/guide-internal-models",
    title: "ECB Guide to internal models",
    framework: "ecb",
    document_id: "ecb-guide-internal-models",
    doc_type: "guide",
    status: "current",
    published: "2024-02-19",
    verified: daysAgo(3),
    milestones: [],
    url: "https://www.bankingsupervision.europa.eu/",
    notes: "No regulation records derive from it yet — registry entries may precede corpus content.",
  },
};

// ============================================================================
// Adapter implementations
// ============================================================================

// The one as-of selection, reporting the basis it served on. `get` delegates to
// it, so the record a tool qualifies with an as_of_note is the record `get`
// would have returned.
const resolveRegulationAsOf = async (id: RegulationId, asOf: string): Promise<AsOfResolution> => {
  const history = HISTORICAL_REGULATIONS[id];
  if (history === undefined) {
    // No recorded versions for this id: the current text is all the demo has,
    // and `basis: "current"` is how the tool says it is not the text of `asOf`.
    const current = REGULATIONS[id] ?? null;
    return current === null ? { record: null } : { record: current, basis: "current" };
  }
  let chosen: Regulation | null = null;
  for (const { effectiveFrom, reg } of history) {
    if (effectiveFrom <= asOf) chosen = reg;
    else break;
  }
  return chosen === null ? { record: null } : { record: chosen, basis: "history" };
};

const inMemoryRegulation: RegulationAdapter = {
  async search(query) {
    return rankedSearch(Object.values(REGULATIONS), query, regulationSearchFields(query)).map(
      (m) => m.record,
    );
  },
  async get(id, asOf) {
    if (!asOf) return REGULATIONS[id] ?? null;
    return (await resolveRegulationAsOf(id, asOf)).record;
  },
  resolveAsOf: resolveRegulationAsOf,
  async list() {
    return Object.values(REGULATIONS);
  },
};

const inMemoryTest: TestAdapter = {
  async search(query) {
    return rankedSearch(Object.values(TESTS), query, testSearchFields).map((m) => m.record);
  },
  async get(id) {
    return TESTS[id] ?? null;
  },
  async list() {
    return Object.values(TESTS);
  },
};

const inMemoryCheck: CheckAdapter = {
  async search(query) {
    return rankedSearch(Object.values(CHECKS), query, checkSearchFields).map((m) => m.record);
  },
  async get(id) {
    return CHECKS[id] ?? null;
  },
  async list() {
    return Object.values(CHECKS);
  },
};

const inMemoryPlaybook: PlaybookAdapter = {
  async search(query) {
    return rankedSearch(Object.values(PLAYBOOKS), query, playbookSearchFields).map((m) => m.record);
  },
  async get(id) {
    return PLAYBOOKS[id] ?? null;
  },
  async list() {
    return Object.values(PLAYBOOKS);
  },
};

const inMemorySource: SourceAdapter = {
  async list(filter) {
    const status = filter?.status;
    const all = Object.values(SOURCES);
    return status === undefined ? all : all.filter((s) => s.status === status);
  },
  async get(id) {
    return SOURCES[id] ?? null;
  },
};

const inMemoryMeta: MetaAdapter = {
  async info() {
    const pending = pendingChangeSummaries(Object.values(SOURCES));
    return {
      last_updated: "2024-10-01T00:00:00Z",
      counts: {
        regulation: Object.keys(REGULATIONS).length,
        test: Object.keys(TESTS).length,
        check: Object.keys(CHECKS).length,
        playbook: Object.keys(PLAYBOOKS).length,
        source: Object.keys(SOURCES).length,
      },
      coverage: ["CRR", "EBA-GL-2017-16"],
      stale_sources: staleSourceIds(Object.values(SOURCES)),
      holdings: computeHoldings(Object.values(REGULATIONS), Object.values(SOURCES)),
      ...(pending === undefined ? {} : { pending_changes: pending }),
    };
  },
  async referrers(id) {
    return computeReferrers(
      {
        regulation: Object.values(REGULATIONS),
        tests: Object.values(TESTS),
        checks: Object.values(CHECKS),
        playbooks: Object.values(PLAYBOOKS),
      },
      id,
    );
  },
  async resolveCitation(text) {
    // Same deterministic matcher as the file adapter — including its refusals,
    // so the demo declines on the same citations a real corpus declines on.
    return resolveCitationDetailed(
      Object.values(REGULATIONS),
      text,
      computeHoldings(Object.values(REGULATIONS), Object.values(SOURCES)),
    );
  },
  async taxonomy() {
    return [...REVIEW_AREAS];
  },
};

// ============================================================================
// Compiled playbooks (1.0): one topic, compiled across documents
// ============================================================================
//
// Not served by the 0.x tools (they read the per-chapter playbooks above); the 1.0
// surface will serve these. They exist here so the renderer and verifier have a
// worked example whose output is pinned by a golden test.

export const DEMO_TOPICS: Topics = {
  version: 1,
  areas: [
    {
      id: "calibration",
      title: "Calibration",
      topics: [
        {
          id: "pd-long-run-average",
          title: "Long-run average default rate for PD calibration",
          scope: "How the long-run average one-year default rate is estimated and shown to be representative of the range of variability.",
          anchors: ["CRR Art. 180(1)(a)", "EBA/GL/2017/16 para 78"],
          questions: ["How do I estimate the long-run average default rate for a PD model?"],
        },
      ],
    },
  ],
};

export const DEMO_COMPILED_PLAYBOOKS: Record<PlaybookId, CompiledPlaybook> = {
  "playbook://pd-long-run-average": {
    id: "playbook://pd-long-run-average",
    title: "Long-run average default rate for PD calibration",
    area: "calibration",
    summary:
      "Estimate each grade's PD from the long-run average of its one-year default rates (Art. 180(1)(a) CRR), and show that the " +
      "average reflects the likely range of variability of those rates, including downturn periods relevant to the portfolio " +
      "(EBA/GL/2017/16 para 78). What counts as a long enough history is a matter of your own policy and the portfolio.",
    questions: [
      "How do I estimate the long-run average default rate for a PD model?",
      "Does the calibration target have to include a downturn?",
    ],
    applies_to: { parameters: ["pd"], stages: ["calibration", "validation"] },
    basis: [
      {
        citation: "Art. 180(1)(a) CRR",
        force: "law",
        role: "PDs are estimated by obligor grade from long-run averages of one-year default rates.",
        provisions: [
          {
            id: "regulation://crr/180/1/a",
            quote: "Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates.",
          },
        ],
      },
      {
        citation: "EBA/GL/2017/16 para 78",
        force: "guideline",
        role: "The calibration target must reflect the likely range of variability of one-year default rates, downturn periods included.",
        provisions: [
          {
            id: "regulation://eba/gl-2017-16/78",
            quote: "the long-run average default rate used as the calibration target reflects the likely range of variability of one-year default rates",
          },
        ],
      },
    ],
    requirements: [
      {
        id: "R1",
        title: "Estimate PDs by grade from long-run averages",
        statement:
          "Derive each grade's PD from the long-run average of its one-year default rates rather than from the latest year. " +
          "Document the grades, the observation window and how the one-year rates are averaged.",
        provisions: [{ id: "regulation://crr/180/1/a" }],
        evidence: ["the grade-level default-rate series", "the averaging method and its documentation"],
        checks: ["check://calibration/pd/lra-derived"],
        tests: [],
      },
      {
        id: "R2",
        title: "Show the target reflects the range of variability",
        statement:
          "Show that the average used as the calibration target reflects how far one-year default rates move, " +
          "including downturn periods relevant to the portfolio, and say what the history leaves out.",
        provisions: [{ id: "regulation://eba/gl-2017-16/78" }],
        evidence: ["the observed range of one-year default rates", "a statement of the downturn periods covered"],
        checks: ["check://calibration/pd/segment-tested"],
        tests: ["test://binomial"],
      },
    ],
    methods: [
      {
        name: "Average the grade-level one-year default rates over the full window",
        description: "The estimate the law names, taken over every year of the window.",
        basis: "regulatory",
        provisions: ["regulation://crr/180/1/a"],
      },
      {
        name: "Compare the target with an external default-rate series",
        description: "A cross-check many institutions run; no provision asks for it.",
        basis: "practice",
        provisions: [],
      },
    ],
    pitfalls: [
      { text: "Using the most recent years only understates a downturn the window did not contain.", provisions: ["regulation://eba/gl-2017-16/78"] },
    ],
    related: [],
    outside_library: [
      { name: "The Commission Delegated Regulation on the IRB assessment methodology", why: "It sets further requirements on the observation period that this topic does not reproduce." },
    ],
    excluded: [
      { id: "regulation://crr/180", reason: "The article's opening sentence; its sub-paragraph is cited." },
      { id: "regulation://eba/gl-2017-16/s4", reason: "A section heading with no requirement of its own." },
    ],
    provenance: {
      status: "approved",
      compiled_at: "2026-10-01T00:00:00Z",
      inputs_sha: "0".repeat(64),
      approved_by: "demo",
      approved_at: "2026-10-02",
    },
  },
};

/** What the renderer and verifier read, over the demo's seed. */
export const demoPlaybookContext = (): PlaybookContext =>
  playbookContext({
    regulations: Object.values(REGULATIONS),
    sources: Object.values(SOURCES),
    checks: Object.values(CHECKS),
    tests: Object.values(TESTS),
    playbooks: Object.values(DEMO_COMPILED_PLAYBOOKS),
  });

// ============================================================================
// Wire-up
// ============================================================================

adapters.regulation = inMemoryRegulation;
adapters.test = inMemoryTest;
adapters.check = inMemoryCheck;
adapters.playbook = inMemoryPlaybook;
adapters.source = inMemorySource;
adapters.meta = inMemoryMeta;

export const demoServer = createServer();

async function main(): Promise<void> {
  await demoServer.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("demo failed to start:", err);
    process.exit(1);
  });
}
