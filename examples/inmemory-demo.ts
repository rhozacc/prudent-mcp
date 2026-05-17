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
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  TestAdapter,
} from "../src/adapters.ts";
import type {
  Check,
  CheckId,
  Playbook,
  PlaybookId,
  Regulation,
  RegulationId,
  ReviewArea,
  Test,
  TestId,
} from "../src/schema.ts";
import { createServer } from "../src/server.ts";

// ============================================================================
// Seed data — one cohesive slice (PD calibration + default definition aside)
// ============================================================================

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
    last_updated: "2024-06-01",
  },
};

const CHECKS: Record<CheckId, Check> = {
  "check://lra-pd-derived": {
    id: "check://lra-pd-derived",
    name: "PD long-run average derived from sufficient history",
    derived_from: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
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
  "check://pd-segment-tested": {
    id: "check://pd-segment-tested",
    name: "PD calibration tested per grade or pool",
    derived_from: ["regulation://crr/180"],
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
  "check://default-definition-90dpd": {
    id: "check://default-definition-90dpd",
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
  "check://default-definition-utp": {
    id: "check://default-definition-utp",
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
          "check://lra-pd-derived",
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
          "check://pd-segment-tested",
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

// ============================================================================
// Adapter implementations
// ============================================================================

const matches = (q: string, ...fields: Array<string | undefined>): boolean => {
  const needle = q.toLowerCase().trim();
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
};

const inMemoryRegulation: RegulationAdapter = {
  async search(query) {
    return Object.values(REGULATIONS).filter((r) => matches(query, r.text, r.citation));
  },
  async get(id, asOf) {
    if (asOf && HISTORICAL_REGULATIONS[id]) {
      let chosen: Regulation | null = null;
      for (const { effectiveFrom, reg } of HISTORICAL_REGULATIONS[id]!) {
        if (effectiveFrom <= asOf) chosen = reg;
        else break;
      }
      return chosen;
    }
    return REGULATIONS[id] ?? null;
  },
};

const inMemoryTest: TestAdapter = {
  async search(query) {
    return Object.values(TESTS).filter((t) =>
      matches(query, t.name, t.purpose, t.family, ...t.aliases),
    );
  },
  async get(id) {
    return TESTS[id] ?? null;
  },
};

const inMemoryCheck: CheckAdapter = {
  async search(query) {
    return Object.values(CHECKS).filter((c) => matches(query, c.name, c.expectation));
  },
  async get(id) {
    return CHECKS[id] ?? null;
  },
};

const inMemoryPlaybook: PlaybookAdapter = {
  async search(query) {
    return Object.values(PLAYBOOKS).filter((p) => matches(query, p.area, p.subarea));
  },
  async get(id) {
    return PLAYBOOKS[id] ?? null;
  },
};

const inMemoryMeta: MetaAdapter = {
  async info() {
    return {
      last_updated: "2024-10-01T00:00:00Z",
      counts: {
        regulation: Object.keys(REGULATIONS).length,
        test: Object.keys(TESTS).length,
        check: Object.keys(CHECKS).length,
        playbook: Object.keys(PLAYBOOKS).length,
      },
      coverage: ["CRR", "EBA-GL-2017-16"],
    };
  },
  async referrers(id) {
    const checks = Object.values(CHECKS)
      .filter((c) => c.derived_from.includes(id as RegulationId))
      .map((c) => c.id);
    const playbooks = Object.values(PLAYBOOKS)
      .filter((p) => p.phases.some((ph) => ph.references.includes(id as RegulationId | TestId | CheckId | PlaybookId)))
      .map((p) => p.id);
    return { regulation: [], tests: [], checks, playbooks };
  },
  async resolveCitation(text) {
    const t = text.toLowerCase().replace(/\s/g, "");
    if (t.includes("178") && t.includes("(1)(a)")) return REGULATIONS["regulation://crr/178/1/a"]!;
    if (t.includes("178") && t.includes("(1)(b)")) return REGULATIONS["regulation://crr/178/1/b"]!;
    if (t.includes("180") && t.includes("(1)(a)")) return REGULATIONS["regulation://crr/180/1/a"]!;
    if (t.includes("180") && t.includes("crr")) return REGULATIONS["regulation://crr/180"]!;
    if ((t.includes("eba") || t.includes("gl")) && t.includes("78"))
      return REGULATIONS["regulation://eba/gl-2017-16/78"]!;
    return null;
  },
  async taxonomy() {
    return [...REVIEW_AREAS];
  },
};

// ============================================================================
// Wire-up
// ============================================================================

adapters.regulation = inMemoryRegulation;
adapters.test = inMemoryTest;
adapters.check = inMemoryCheck;
adapters.playbook = inMemoryPlaybook;
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
