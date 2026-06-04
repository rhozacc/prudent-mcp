# Use case examples

Real prompts, real tool calls, simulated responses — how an MCP-equipped client drives the corpus.

::: warning Illustrative — full corpus, not the demo
These walkthroughs show what the **complete prudent corpus** answers. Most reference regulation, checks, tests, and playbooks — downturn LGD, MoC, representativeness, overrides, IFRS9, AUROC — that are **not in the open-source in-memory demo**, which carries only a PD-calibration and default-definition slice. The tool-call shapes are representative; the responses are illustrative, not literal demo output.
:::

---

## 1. "What does Art. 178(1)(a) actually say?"

> **Analyst:** Art. 178(1)(a) — can you pull the exact text and tell me what checks we have against it?

<!-- Claude doesn't guess from training data. It resolves the citation to a structured URI first. -->

```ts
resolve_citation("Art. 178(1)(a)")
→ regulation://crr/178/1/a
```

<!-- Then fetches the verbatim text plus any attached supervisor commentary. -->

```ts
get_regulation("regulation://crr/178/1/a")
→ text: "A default shall be considered to have occurred when the institution
         considers that the obligor is unlikely to pay..."
  commentary: [EBA GL 2016/07 para 47 — mandatory UTP indicators]
```

<!-- Then walks the reverse index to find what operationalises it. -->

```ts
get_referrers("regulation://crr/178/1/a")
→ checks: ["check://default-definition/utp"]
   playbooks: ["playbook://default-definition"]
```

> **Claude:** CRR 178(1)(a) is the unlikely-to-pay (UTP) limb of the default definition. The EBA GL 2016/07 commentary attached to it specifies the mandatory indicators — non-accrued status, specific credit adjustment, sale at material credit-related economic loss, distressed restructuring, and bankruptcy. The corpus has one check against it (`check://default-definition/utp`) which expects written policy, a mapping of each mandatory indicator to implementation, and documentation of any institution-specific additions.

---

## 2. "I'm starting a PD calibration review — what do I need?"

> **Analyst:** Starting a PD calibration review on a retail mortgage model. Where do I begin and what should I be gathering?

<!-- One call returns the full entry point: review area, all playbooks for it, expanded with every regulation/check/test referenced inline, plus deduplicated ID lists. No N+1 fetches. -->

```ts
get_area_overview("calibration.pd")
→ area: { id: "calibration.pd", name: "PD Calibration" }
  playbooks: [
    playbook://calibration/pd  (3 phases, fully expanded)
  ]
  regulation_ids: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"]
  check_ids:      ["check://calibration/pd/lra-derived", "check://calibration/pd/segment-tested"]
  test_ids:       ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"]
```

> **Claude:** The PD calibration review has three phases. First, validate the long-run average derivation — you'll need the default rate time series, economic cycle justification, and a reconciliation of the historical default definition to the one currently applied. Second, test calibration at grade level using a binomial-family test (Jeffreys or one-sided binomial) per grade and Hosmer-Lemeshow at portfolio level. Third, document any deviations against EBA GL expectations. The two gates are: LRA period covers a full economic cycle, and all material grades tested individually.

---

## 3. "The bank runs something called a 'modified chi-squared decile test' — is that acceptable?"

> **Analyst:** Their validation report says they use a "modified chi-squared decile test" for PD calibration at portfolio level. Is that an acceptable methodology?

<!-- Claude searches for the test by its alias, not its canonical name. -->

```ts
search_tests("chi-squared decile")
→ [{ id: "test://hosmer-lemeshow",
     name: "Hosmer-Lemeshow test",
     aliases: ["HL test", "HL chi-squared", "modified HL"],
     family: "calibration-grouped" }]
```

<!-- The family field is the equivalence key. Claude reasons over it rather than doing a name match. -->

> **Claude:** That's a variant of the Hosmer-Lemeshow test — same `calibration-grouped` family. The methodology is acceptable as long as it groups predictions into buckets and the acceptance bar is a chi-squared statistic with g-2 degrees of freedom (p > 0.05). The specific name doesn't matter; what matters is that it belongs to the HL family and the acceptance criteria are met. If their report states the grouping logic and the p-value threshold, that's sufficient.

---

## 4. "What did the 90 DPD rule say when this model was built in 2014?"

> **Analyst:** This model was validated in 2014 under the original CRR. What did the 90-day past due backstop actually say back then, before the RTS on materiality thresholds came in?

<!-- Historical version lookup — as_of pins to the regulation text that was in force on that date. -->

```ts
get_regulation("regulation://crr/178/1/b", as_of="2014-06-01")
→ document_version: "2013-06-26"
   text: "...Materiality is left to national competent authority discretion."
```

<!-- Contrast with the current version. -->

```ts
get_regulation("regulation://crr/178/1/b")
→ document_version: "2024-01-09"
   text: "...materiality assessed against thresholds set in the relevant
          Commission Delegated Regulation."
```

> **Claude:** In 2014 the CRR left materiality of the 90 DPD trigger to national competent authority discretion — there was no harmonised threshold. The Commission Delegated Regulation on materiality thresholds came in under CRR2 (effective 2021). If the model was built and validated in 2014, the reviewer at the time would have applied the NCA's local threshold. You'd want to check what threshold was in force under the relevant NCA at the time, and whether the model was subsequently recalibrated when the harmonised thresholds took effect.

---

## 5. "Their downturn LGD is just baseline + 10%. Is that defensible?"

> **Analyst:** The validation report says: "Downturn LGD = baseline LGD × 1.10." That's the entire downturn methodology. Is this acceptable?

<!-- Claude pulls the regulatory anchor first. -->

```ts
resolve_citation("CRR Art. 181 downturn LGD")
→ regulation://crr/181/1/b
```

```ts
get_regulation("regulation://crr/181/1/b")
→ text: "...where LGD estimates are not appropriate for an economic downturn,
         institutions shall use LGD estimates that are appropriate for an
         economic downturn..."
  commentary: [EBA RTS on downturn LGD — Reference Value approach and
               three permissible methodologies]
```

<!-- Then walks the checks against it. -->

```ts
get_referrers("regulation://crr/181/1/b")
→ checks: ["check://lgd/downturn/methodology", "check://lgd/downturn/reference-value"]
```

```ts
get_check("check://lgd/downturn/methodology")
→ expectation: "Downturn LGD is derived from one of: (i) observed historical
                downturn losses, (ii) impact assessment with calibration to
                downturn observations, or (iii) the Reference Value where
                neither (i) nor (ii) is feasible. A flat additive or multiplicative
                margin without one of these underpinnings does not meet the
                requirement."
  expected_evidence: [
    "Methodology selection memo with justification",
    "If (i): identified downturn period and observed LGDs",
    "If (ii): impact assessment model and calibration evidence",
    "If (iii): Reference Value computation per EBA RTS"
  ]
```

> **Claude:** Not acceptable as written. The EBA RTS on downturn LGD (in force from 2021) is explicit: institutions must use one of three permissible methodologies — observed historical downturn losses, an impact assessment, or the Reference Value floor. A flat ×1.10 buffer is none of these. The check `check://lgd/downturn/methodology` flags this directly. The bank either has hidden methodology behind that headline number (in which case the validation report is incomplete) or they're non-compliant with the RTS. Either way, the finding is "downturn LGD methodology is not evidenced." Ask for the underlying derivation; if the 10% is the entire story, this is a material finding against CRR 181(1)(b).

---

## 6. "We have 200 manual overrides per quarter. How do I validate that?"

> **Analyst:** The model assigns a grade, but the rating committee overrides it for about 200 obligors per quarter. How does the framework expect us to validate the override process?

<!-- Override analysis sits inside model use and rating assignment — let's find the right playbook. -->

```ts
list_review_areas()
→ [..., { id: "rating-assignment.overrides", name: "Rating overrides", parent: "rating-assignment" }, ...]
```

```ts
get_area_overview("rating-assignment.overrides")
→ area: { id: "rating-assignment.overrides", name: "Rating overrides" }
  playbooks: [playbook://rating-assignment/overrides (4 phases)]
  regulation_ids: ["regulation://crr/172/3", "regulation://eba/gl-2017-16/53",
                   "regulation://eba/gl-2017-16/55"]
  check_ids: ["check://rating-assignment/overrides/policy-documented",
              "check://rating-assignment/overrides/rate-monitored",
              "check://rating-assignment/overrides/performance-tracked"]
```

<!-- Pull the performance-tracking check since rate alone isn't sufficient. -->

```ts
get_check("check://rating-assignment/overrides/performance-tracked")
→ expectation: "Override performance is tracked separately from non-override
                cases. Default rates of overridden grades are compared to both
                model-assigned grades and to expected PD; persistent deviation
                triggers a model review."
  expected_evidence: [
    "Override register with original and final grade, reason code, and approver",
    "Periodic (at least annual) performance analysis comparing override vs non-override default rates",
    "Override rate trend by segment and reason code",
    "Documented threshold for triggering a model review"
  ]
```

> **Claude:** 200 overrides per quarter is a meaningful population — well past the threshold where override performance has to be tracked separately. EBA GL 2017/16 para 55 mandates that overrides are monitored both in volume (override rate by segment) and in performance (do overridden obligors default at the new grade's PD, or at the original grade's PD?). The corpus playbook `playbook://rating-assignment/overrides` walks the four phases: policy adequacy, override rate analysis, performance tracking, and trigger thresholds for model review. For your portfolio, the immediate questions are: do you have a register with reason codes? Is override performance reported at least annually? And is there a defined threshold (e.g., "if override-default-rate exceeds final-grade PD by N basis points for two consecutive periods, trigger a review")? If any of those is missing, that's a finding under para 55.

---

## 7. "The development sample is from 2008–2015. The portfolio today is 60% new products. Representative?"

> **Analyst:** The PD model was developed on 2008–2015 data. Since 2018 the bank has launched three new product lines, and they're now 60% of the book. The model is still being used for them. Representativeness issue?

<!-- Two regulatory anchors apply — the general representativeness mandate and the EBA elaboration. -->

```ts
search_regulation("representative data")
→ [
    { id: "regulation://crr/174/c", citation: "CRR Article 174(c)" },
    { id: "regulation://eba/gl-2017-16/84", citation: "EBA GL 2017/16 para 84" }
  ]
```

```ts
get_regulation("regulation://eba/gl-2017-16/84")
→ text: "...institutions shall demonstrate that the data used for risk
         parameter estimation is representative of the portfolio to which
         the model is applied..."
  commentary: [Q&A 2020_5311 — representativeness assessment across obligor type,
               product, geography, vintage; quantitative comparison required]
```

```ts
get_check("check://representativeness/development-vs-application")
→ expectation: "Development sample is compared to application portfolio across
                obligor type, product, geography, vintage, and risk driver
                distribution. Material misalignment requires either a model
                update, a portfolio carve-out, or a documented MoC."
```

> **Claude:** 60% of the current portfolio being products the model never saw is a hard finding. EBA GL para 84 requires demonstrated representativeness of the development sample against the application portfolio across obligor type, product, geography, vintage, and risk driver distribution. Three new product lines comprising the majority of the book is material misalignment on the product dimension. The check `check://representativeness/development-vs-application` lays out the three permissible responses: model update, portfolio carve-out, or documented MoC under EBA GL paras 36–47. A 2008–2015 development sample combined with 2018+ new products without one of those responses is non-compliant. The fact that the model is still being applied means there's likely a Category B (methodological) MoC owed at minimum, plus a model performance review specifically on the new product cohort.

---

## 8. "Their MoC is 'expert judgement, 50bp'. That's the entire justification."

> **Analyst:** The model documentation says: "Margin of conservatism: +50bp added to PD, based on expert judgement." That's the whole MoC section. Is this defensible?

<!-- MoC has its own EBA GL section with explicit category requirements. -->

```ts
search_regulation("margin of conservatism")
→ [
    { id: "regulation://eba/gl-2017-16/36", citation: "EBA GL 2017/16 para 36" },
    { id: "regulation://eba/gl-2017-16/43", citation: "EBA GL 2017/16 para 43" },
    { id: "regulation://eba/gl-2017-16/47", citation: "EBA GL 2017/16 para 47" }
  ]
```

```ts
get_regulation("regulation://eba/gl-2017-16/43")
→ text: "Institutions shall categorise the MoC according to the following
         categories: (a) Category A — MoC for data and methodological
         deficiencies; (b) Category B — MoC for relevant changes; (c)
         Category C — general estimation error..."
```

```ts
get_check("check://moc/categorisation")
→ expectation: "Every MoC is classified into Category A, B, or C with a
                stated deficiency, a quantification approach, and a periodic
                reassessment process. An undocumented buffer applied as
                'expert judgement' is not a valid MoC."
  expected_evidence: [
    "Category assignment per MoC",
    "Identified deficiency the MoC compensates for",
    "Quantification methodology",
    "Process for periodic reassessment and potential removal"
  ]
```

> **Claude:** "Expert judgement, 50bp" doesn't meet the MoC framework. EBA GL 2017/16 paras 36–47 require every MoC to be categorised (A: data/methodology deficiencies; B: relevant changes since development; C: general estimation error), justified against a specific deficiency, quantified through a documented method, and periodically reassessed. A flat 50bp without category, deficiency, or methodology fails every one of those tests. The check `check://moc/categorisation` is unambiguous on this. The finding is: "applied MoC of 50bp is not categorised, justified, or quantified per EBA GL paras 36–47." The bank either needs to retrofit the framework — which Category? Compensating for what? Computed how? — or remove the buffer. There's no defensible middle ground where "expert judgement" stands as the full justification.

---

## 9. "Is the model's IFRS9 definition of default the same as the IRB one?"

> **Analyst:** Model owner says the IFRS9 stage 3 definition is the same as the IRB default definition. Should I take that at face value?

<!-- The definitions overlap heavily but not perfectly. Let's pull both anchors. -->

```ts
resolve_citation("CRR 178 default definition")
→ regulation://crr/178
```

```ts
get_regulation("regulation://crr/178")
→ children: ["regulation://crr/178/1/a", "regulation://crr/178/1/b",
             "regulation://crr/178/3", "regulation://crr/178/5"]
  commentary: [EBA GL 2016/07 — operational application of the default definition;
               Q&A 2017_3453 — alignment with IFRS9 stage 3]
```

<!-- The Q&A is the relevant commentary — pull it specifically. -->

```ts
get_check("check://default-definition/ifrs9-alignment")
→ expectation: "Where the institution uses the IFRS9 stage 3 definition as the
                IRB default definition, the two definitions are demonstrated to
                be identical in trigger and cure logic. Material divergence
                requires either alignment, dual flagging, or a documented
                reconciliation with a Category A MoC."
  expected_evidence: [
    "Side-by-side comparison of stage 3 triggers and IRB default triggers",
    "Cure logic comparison",
    "Reconciliation of stage 3 population to IRB defaulted population",
    "If divergence: MoC quantification or remediation plan"
  ]
```

> **Claude:** Take it with caution. IFRS9 stage 3 and IRB default definitions overlap heavily — both anchor on 90 DPD and on unlikely-to-pay — but the IFRS9 trigger and cure logic isn't automatically identical to the IRB one. The check `check://default-definition/ifrs9-alignment` is exactly this question. EBA Q&A 2017_3453 (commentary on CRR 178) addresses it: alignment is permitted, but it has to be demonstrated, not asserted. Concretely: ask for the side-by-side trigger comparison, the cure logic comparison, and a reconciliation of the stage 3 population to the IRB defaulted population over the most recent reporting period. Common divergences I'd look for: SICR-driven stage 3 transitions that aren't UTP under CRR; differential cure periods; different treatment of forborne exposures. If any of those produces material divergence and the bank still uses one definition for both — that's a finding, with either alignment or a MoC required.

---

## 10. "Model AUROC dropped from 0.78 to 0.69 over three years. Action?"

> **Analyst:** Discriminatory power monitoring shows AUROC trending down from 0.78 (2021) to 0.69 (2024). What's the corpus say?

<!-- This is performance monitoring against the supervisory bar. -->

```ts
search_tests("AUROC")
→ [{ id: "test://auroc",
     family: "discrimination",
     acceptance_criteria: "AUROC >= 0.70 with documented portfolio context;
                           values below 0.70 require explicit justification or
                           remediation" }]
```

```ts
get_area_overview("monitoring.discrimination")
→ playbooks: [playbook://monitoring/discrimination (3 phases)]
  check_ids: ["check://monitoring/discrimination/threshold-breach",
              "check://monitoring/discrimination/trend-analysis",
              "check://monitoring/discrimination/escalation"]
```

```ts
get_check("check://monitoring/discrimination/threshold-breach")
→ expectation: "When AUROC falls below 0.70 or shows persistent downward
                trend over three or more reporting periods, the model owner
                initiates root-cause analysis. Persistent breach triggers
                model redevelopment or recalibration."
  derived_from: ["regulation://crr/185", "regulation://eba/gl-2017-16/189"]
```

> **Claude:** Two issues at once. First, you've crossed the 0.70 threshold — AUROC at 0.69 is below the supervisory bar in the corpus, and below the typical acceptance criterion at most banks. Second, the three-year downward trend (0.78 → 0.69) is itself a trigger, regardless of the absolute value. The check `check://monitoring/discrimination/threshold-breach` mandates root-cause analysis when either condition holds; you have both. CRR Art. 185 requires ongoing review of model performance, and EBA GL 2017/16 para 189 specifies that material deterioration must be acted on rather than tolerated. Expected next steps: a documented root-cause analysis (data drift? new segments? definition changes?), a remediation plan with timeline, and — if discrimination doesn't recover within the next review cycle — a recalibration or redevelopment trigger. Continuing to use the model without one of those is a finding under both Article 185 and the EBA GL.

---

## 11. Chained: "Walk this PD model end-to-end and tell me what's broken"

A single high-level instruction. The model decomposes it, drives the corpus through ten or so tool calls, and lands on a finding list ranked by severity. This is what an MCP-equipped client looks like at full stretch.

> **Analyst:** I'm reviewing the retail mortgage PD model. Default rate has drifted upward for two years, the bank uses a modified HL test I haven't seen before, their MoC documentation is thin, and the development sample is 2010–2017. Walk the model end-to-end and tell me what's broken.

<!-- Step 1: Anchor on the canonical taxonomy slug. The analyst said "PD model"; the corpus uses dotted slugs. -->

```ts
list_review_areas()
→ [
    { id: "calibration.pd", name: "PD Calibration", ... },
    { id: "representativeness", name: "Representativeness", ... },
    { id: "monitoring.discrimination", name: "Discrimination monitoring", ... },
    { id: "moc", name: "Margin of conservatism", ... },
    ...
  ]
```

<!-- Step 2: Pull the full PD calibration entry point in one shot — area + expanded playbook + every regulation/check/test referenced inline. -->

```ts
get_area_overview("calibration.pd")
→ area: { id: "calibration.pd", name: "PD Calibration" }
  playbooks: [playbook://calibration/pd (3 phases, fully expanded)]
  regulation_ids: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78",
                   "regulation://eba/gl-2017-16/82"]
  check_ids:      ["check://calibration/pd/lra-derived",
                   "check://calibration/pd/segment-tested"]
  test_ids:       ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"]
```

<!-- Step 3: The analyst mentioned drift, so cross to monitoring/discrimination as well. -->

```ts
get_area_overview("monitoring.discrimination")
→ check_ids: ["check://monitoring/discrimination/threshold-breach",
              "check://monitoring/discrimination/trend-analysis"]
   test_ids: ["test://auroc", "test://gini", "test://ks-statistic"]
```

<!-- Step 4: Resolve the "modified HL test" against the corpus by family, not name. -->

```ts
search_tests("modified HL")
→ [{ id: "test://hosmer-lemeshow",
     family: "calibration-grouped",
     aliases: ["HL test", "HL chi-squared", "modified HL", "chi-squared decile test"],
     acceptance_criteria: "Chi-squared statistic with g-2 degrees of freedom; p > 0.05 for acceptance" }]
```

<!-- Step 5: The 2010–2017 development sample is now seven years old. Pull the representativeness check. -->

```ts
get_check("check://representativeness/development-vs-application")
→ expectation: "Development sample is compared to application portfolio across
                obligor type, product, geography, vintage, and risk driver
                distribution. Material misalignment requires either a model
                update, a portfolio carve-out, or a documented MoC."
  derived_from: ["regulation://crr/174/c", "regulation://eba/gl-2017-16/84"]
```

<!-- Step 6: Thin MoC docs — pull the MoC framework requirements. -->

```ts
get_check("check://moc/categorisation")
→ expectation: "Every MoC is classified into Category A, B, or C with a
                stated deficiency, a quantification approach, and a periodic
                reassessment process."
  derived_from: ["regulation://eba/gl-2017-16/36", "regulation://eba/gl-2017-16/43"]
```

<!-- Step 7: Default rate drift suggests LRA period may no longer cover a cycle. Pull the LRA check explicitly. -->

```ts
get_check("check://calibration/pd/lra-derived")
→ expectation: "PD long-run average is computed over a period containing at
                least one full economic cycle, with a minimum of five years of
                default data."
```

<!-- Step 8: Final cross-reference — what playbooks recurse into this set, so nothing is missed at the seams. -->

```ts
get_referrers("regulation://eba/gl-2017-16/84")
→ checks: ["check://representativeness/development-vs-application"]
   playbooks: ["playbook://calibration/pd", "playbook://representativeness"]
```

<!-- Now synthesis. -->

> **Claude:** Five findings, ranked.
>
> **F1 — Material (representativeness × MoC).** The 2010–2017 development sample is now 7+ years old. EBA GL para 84 requires demonstrated representativeness across product, geography, vintage, and risk driver distribution. If the current portfolio has materially different vintage or product mix from 2010–2017 — and the upward default-rate drift you describe suggests it does — then under `check://representativeness/development-vs-application` the bank owes either a model update, a portfolio carve-out, or a documented Category B MoC. The "thin MoC documentation" you flagged compounds this: even if a Category B MoC was intended, it needs categorisation, deficiency statement, quantification, and reassessment cadence per EBA GL paras 36–47.
>
> **F2 — Material (LRA period & default rate drift).** Two years of upward drift suggests the long-run average may now be biased low against the current cycle position. `check://calibration/pd/lra-derived` requires the LRA period to cover a full cycle, and EBA Q&A 2018_3804 (commentary on CRR 180/1/a) elaborates: where the historical sample isn't representative of current cycle conditions, supplementary data or a conservative adjustment is required. The bank's options are recalibration with a refreshed LRA window, an explicit cycle-coverage justification, or — again — a quantified MoC. Continuing to apply the LRA derived from 2010–2017 without one of these is non-compliant.
>
> **F3 — Methodological clarification (not necessarily a finding).** The "modified HL test" you haven't seen is in the corpus as a known alias of Hosmer-Lemeshow — `family: calibration-grouped`. The methodology is acceptable as long as the acceptance bar (chi-squared with g-2 degrees of freedom, p > 0.05) holds. Confirm the bank's report states the grouping logic, the degrees of freedom, and the p-value threshold. If those are documented, this isn't a finding. If any is missing, that's a documentation finding under `check://calibration/pd/segment-tested`.
>
> **F4 — Material (MoC framework).** Independent of F1, the thin MoC documentation by itself fails `check://moc/categorisation`. EBA GL 2017/16 paras 36–47 mandate categorisation (A/B/C), specific deficiency, quantification method, and periodic reassessment. "Thin" almost always means at least one of those is missing. Ask explicitly for the category assignment per MoC, the deficiency each compensates for, and the quantification approach. If the bank can't produce these, this is a finding regardless of the size of the buffer.
>
> **F5 — Monitoring trigger.** Two years of upward default-rate drift is itself a `check://monitoring/discrimination/trend-analysis` trigger. Even before you decide F1 and F2, the bank should have documented root-cause analysis, a remediation plan, and (under CRR Art. 185 and EBA GL para 189) escalation to model owner. Ask whether that process ran; if not, that's a process finding distinct from F1–F4.
>
> Suggested order of work: confirm F3 first (cheapest — likely a documentation gap, not a methodology gap), then drive F4 to closure (independent of model state), then tackle F1/F2/F5 together since they share root cause and remediation options.

---

The chain above is ten tool calls. The host (Claude Desktop, Claude Code, Cursor) runs them automatically — the analyst writes a paragraph, the model decomposes it, and the corpus grounds every claim in a typed citation back to law. The synthesis at the end is the model's; the IDs are the corpus's.
