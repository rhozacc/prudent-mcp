# Use case examples

Real prompts, real tool calls, simulated responses. The MCP is connected in all four threads.

---

## 1. "What does Art. 178(1)(a) actually say?"

> **Analyst:** Art. 178(1)(a) — can you pull the exact text and tell me what checks we have against it?

<!-- Claude doesn't guess from training data. It resolves the citation to a structured URI first. -->

```
resolve_citation("Art. 178(1)(a)")
→ regulation://crr/178/1/a
```

<!-- Then fetches the verbatim text plus any attached supervisor commentary. -->

```
get_regulation("regulation://crr/178/1/a")
→ text: "A default shall be considered to have occurred when the institution
         considers that the obligor is unlikely to pay..."
  commentary: [EBA GL 2016/07 para 47 — mandatory UTP indicators]
```

<!-- Then walks the reverse index to find what operationalises it. -->

```
get_referrers("regulation://crr/178/1/a")
→ checks: ["check://default-definition/utp"]
   playbooks: ["playbook://default-definition"]
```

> **Claude:** CRR 178(1)(a) is the unlikely-to-pay (UTP) limb of the default definition. The EBA GL 2016/07 commentary attached to it specifies the mandatory indicators — non-accrued status, specific credit adjustment, sale at material credit-related economic loss, distressed restructuring, and bankruptcy. The corpus has one check against it (`check://default-definition/utp`) which expects written policy, a mapping of each mandatory indicator to implementation, and documentation of any institution-specific additions.

---

## 2. "I'm starting a PD calibration review — what do I need?"

> **Analyst:** Starting a PD calibration review on a retail mortgage model. Where do I begin and what should I be gathering?

<!-- One call returns the full entry point: review area, all playbooks for it, expanded with every regulation/check/test referenced inline, plus deduplicated ID lists. No N+1 fetches. -->

```
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

```
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

```
get_regulation("regulation://crr/178/1/b", as_of="2014-06-01")
→ document_version: "2013-06-26"
   text: "...Materiality is left to national competent authority discretion."
```

<!-- Contrast with the current version. -->

```
get_regulation("regulation://crr/178/1/b")
→ document_version: "2024-01-09"
   text: "...materiality assessed against thresholds set in the relevant
          Commission Delegated Regulation."
```

> **Claude:** In 2014 the CRR left materiality of the 90 DPD trigger to national competent authority discretion — there was no harmonised threshold. The Commission Delegated Regulation on materiality thresholds came in under CRR2 (effective 2021). If the model was built and validated in 2014, the reviewer at the time would have applied the NCA's local threshold. You'd want to check what threshold was in force under the relevant NCA at the time, and whether the model was subsequently recalibrated when the harmonised thresholds took effect.
