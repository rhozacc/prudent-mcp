# Prompts

Three prompt scaffolds for guided review walkthroughs. Defined in `src/prompts/validateReviewArea.ts`.

Prompts return short instruction sets that orient the model around the corpus's structure. They don't pre-fetch content — they tell the model what to do and in what order, so the model issues the right tool calls itself.

---

## `validate_review_area`

Guided walkthrough for validating a review area. Orients the model around the relevant playbook, checks, and regulations.

**Argument:** `area: string` — the review area name or slug (e.g. `"PD calibration"`, `"calibration.pd"`)

**What it does:** Instructs the model to:
1. Use `list_review_areas` to confirm the canonical area id
2. Fetch the corresponding playbook via `search_playbooks` or `get_playbook`
3. For each phase, retrieve the referenced regulation, tests, and checks
4. Walk the bank's documentation against the phase expectations and gates
5. Report findings grouped by phase, citing the regulation and check IDs that ground each one

---

## `review_calibration`

Calibration-specific review walkthrough (PD / LGD / EAD).

**Argument:** `component: string` — the model component (`"PD"`, `"LGD"`, `"EAD"`)

**What it does:** Instructs the model to:
1. Fetch `playbook://calibration/{component}` (fall back to `playbook://calibration` if absent)
2. For each phase, retrieve the referenced regulation, tests, and checks
3. Identify which calibration tests the bank ran and check family-equivalence against the corpus
4. Verify long-run-average derivation, segment-level testing, and documented deviations
5. Report findings citing regulation and check IDs

This prompt is calibration-specific because calibration has domain-specific requirements around LRA period, economic cycle coverage, and binomial-family test selection that warrant dedicated scaffolding.

---

## `assess_findings`

Walk a set of findings against regulatory expectations.

**Argument:** `severity?: string` — optional filter (e.g. `"material"`, `"minor"`; defaults to `"outstanding"`)

**What it does:** For each finding, instructs the model to:
1. Identify the relevant regulation (use `resolve_citation` if the finding references one in prose)
2. Identify the related check via `search_checks`
3. Confirm the finding is supported by the regulation/check pair, or flag if the link is missing
4. Use `get_referrers` to surface anything else in the corpus that bears on the same regulation
5. Report each finding with its regulation and check IDs

---

## Using prompts

Prompts are surfaced in MCP as first-class objects alongside tools. In Claude Desktop or Claude Code they appear in the prompt palette. In custom integrations, call the `prompts/get` MCP method with the prompt name and arguments.

The scaffolds are intentionally minimal — the model does the reasoning; the prompt provides the call order and the output structure.
