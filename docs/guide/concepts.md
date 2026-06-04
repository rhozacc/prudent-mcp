# Concepts

The corpus models a specific working domain — internal ratings-based (IRB) credit-risk model validation. This page explains the concepts the schema is built around. If you've never read the CRR or the EBA guidelines on PD-LGD estimation, start here.

If you already know the domain and want the schema, skip to [Corpus structure](/corpus/).

## The four surfaces, conceptually

<div class="diagram" v-pre>
<svg viewBox="0 0 720 220" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;color:var(--vp-c-text-1);">
  <style>
    .box   { fill: var(--vp-c-bg-soft); stroke: currentColor; stroke-width: 1.5; }
    .label { fill: currentColor; font: 600 14px ui-sans-serif, system-ui, sans-serif; }
    .sub   { fill: currentColor; font: 400 11px ui-sans-serif, system-ui, sans-serif; opacity: 0.7; }
    .arrow { stroke: currentColor; stroke-width: 1.4; fill: none; marker-end: url(#a); opacity: 0.6; }
  </style>
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect class="box" x="30"  y="60"  width="140" height="80" rx="6"/>
  <text class="label" x="100" y="92"  text-anchor="middle">Regulation</text>
  <text class="sub"   x="100" y="112" text-anchor="middle">what the law says</text>
  <rect class="box" x="220" y="20"  width="140" height="80" rx="6"/>
  <text class="label" x="290" y="52"  text-anchor="middle">Test</text>
  <text class="sub"   x="290" y="72"  text-anchor="middle">how to measure</text>
  <rect class="box" x="220" y="120" width="140" height="80" rx="6"/>
  <text class="label" x="290" y="152" text-anchor="middle">Check</text>
  <text class="sub"   x="290" y="172" text-anchor="middle">what passes</text>
  <rect class="box" x="540" y="60"  width="140" height="80" rx="6"/>
  <text class="label" x="610" y="92"  text-anchor="middle">Playbook</text>
  <text class="sub"   x="610" y="112" text-anchor="middle">how to walk it</text>
  <path class="arrow" d="M170,90  L220,60"/>
  <path class="arrow" d="M170,110 L220,160"/>
  <path class="arrow" d="M360,60  L540,90"/>
  <path class="arrow" d="M360,160 L540,110"/>
</svg>
</div>

The four surfaces correspond to the four kinds of artifact you actually deal with on a validation:

- **Regulation** is what the supervisor and the law require. It's the ground truth and the only versioned surface.
- **Tests** are the statistical procedures — Hosmer-Lemeshow, Jeffreys, AUROC, Brier score — that turn portfolio data into evidence.
- **Checks** are the qualitative bar: a concrete pass/fail expectation, traced back to the regulation it operationalises.
- **Playbooks** are the walkthroughs that combine all of the above into an ordered review.

## IRB in one paragraph

Under the Capital Requirements Regulation (CRR), banks can use their own internal models — rather than standardised risk weights — to compute regulatory capital for credit risk. The model has to estimate, for each obligor or facility, a probability of default (PD), a loss given default (LGD), and an exposure at default (EAD). The supervisor approves the model and then validates it on an ongoing basis. Validation means proving the model is calibrated, discriminating, and aligned with the regulation — including how default is defined, how the data history is used, and how downturn conditions are reflected.

## The concepts the corpus is built around

The schema is shaped by the artifacts a validator works with, not by the regulation's table of contents. The recurring ones:

- **Default definition** — the trigger that flips an obligor from performing to defaulted.
- **PD calibration** — the assertion that observed default rates match estimated PDs.
- **Discriminatory power** — whether the model ranks defaulters above non-defaulters.
- **Long-run average (LRA)** — the multi-year base every PD estimate is derived from.
- **Downturn LGD / EAD** — loss parameters under stressed conditions.
- **Margin of conservatism (MoC)** — a buffer for known weaknesses in an estimate.
- **Representativeness** — whether the development data matches the portfolio the model is applied to.
- **Rating philosophy** — point-in-time vs through-the-cycle.

Each maps to regulation, tests, and checks in the corpus. The corpus *describes* these and traces them to law; it doesn't teach the domain — for that, read the primary sources (the CRR and the EBA guidelines).

## Where the corpus stops

The MCP describes — it doesn't execute. Concretely:

- ✅ It tells you what the Hosmer-Lemeshow test measures and how to read the p-value.
- ❌ It doesn't run the test on portfolio data.
- ✅ It tells you what evidence a `check://calibration/pd/lra-derived` requires.
- ❌ It doesn't gather the evidence or judge whether it's sufficient.
- ✅ It serves the regulatory text in force on a given date.
- ❌ It doesn't decide whether the bank complied with that text.

That boundary is load-bearing. Execution and judgement happen elsewhere — typically `prudent-runtime` for statistical computation and the model owner / validator for judgement. The MCP keeps the knowledge layer pure.

## How LLMs use this

A well-equipped LLM client (Claude Desktop, Claude Code, Cursor) talks to `prudent-mcp` and the analyst at the same time. The model:

1. Parses the analyst's question or the bank's documentation.
2. Resolves prose citations (`"Art. 178(1)(a)"`) into structured `regulation://` URIs via `resolve_citation`.
3. Pulls verbatim regulation text and any attached commentary.
4. Walks the `derived_from` chain on relevant checks.
5. Maps bank-specific test names onto corpus entries through the `family` and `aliases` fields.
6. Cites everything back to the analyst with structured IDs.

The model does the reasoning. The MCP makes sure the reasoning is grounded in primary sources rather than training-data guesswork.
