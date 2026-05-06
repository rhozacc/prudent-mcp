/**
 * Prompts — guided walkthroughs for review areas.
 *
 * These return short scaffolds that orient the model around the corpus's
 * structure. Bodies are intentionally minimal so the host LLM does the
 * thinking; richer prompt content can be added without changing names or
 * argument shapes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "validate_review_area",
    {
      description:
        "Guided walkthrough for validating a review area. Orients the model " +
        "around the relevant playbook, checks, and regulations.",
      argsSchema: { area: z.string() },
    },
    ({ area }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Validate the "${area}" review area.\n\n` +
              `1. Use list_review_areas to confirm the canonical area id.\n` +
              `2. Fetch the corresponding playbook (search_playbooks or get_playbook).\n` +
              `3. For each phase, retrieve the referenced regulation, tests, and checks.\n` +
              `4. Walk the bank's documentation against the phase expectations and gates.\n` +
              `5. Report findings grouped by phase, citing the regulation and check IDs that ground each one.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_calibration",
    {
      description:
        "Calibration-specific review walkthrough (PD / LGD / EAD).",
      argsSchema: { component: z.string() },
    },
    ({ component }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Review the calibration of the ${component} model.\n\n` +
              `1. Fetch playbook://calibration/${component.toLowerCase()} (fall back to playbook://calibration if absent).\n` +
              `2. For each phase, retrieve the referenced regulation, tests, and checks.\n` +
              `3. Identify which calibration tests the bank ran and check family-equivalence against the corpus.\n` +
              `4. Verify long-run-average derivation, segment-level testing, and documented deviations.\n` +
              `5. Report findings citing regulation and check IDs.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "assess_findings",
    {
      description:
        "Walk a set of findings against regulatory expectations.",
      argsSchema: { severity: z.string().optional() },
    },
    ({ severity }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Assess the ${severity ?? "outstanding"} findings against the corpus.\n\n` +
              `For each finding:\n` +
              `1. Identify the relevant regulation (resolve_citation if the finding references one in prose).\n` +
              `2. Identify the related check (search_checks by topic).\n` +
              `3. Confirm the finding is supported by the regulation/check pair, or flag if the link is missing.\n` +
              `4. Use get_referrers to surface anything else in the corpus that bears on the same regulation.\n` +
              `5. Report each finding with its regulation and check IDs.`,
          },
        },
      ],
    }),
  );
}
