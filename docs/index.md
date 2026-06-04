---
layout: home
hero:
  name: prudent-mcp
  text: IRB model validation knowledge layer
  tagline: Structured access to regulation, tests, checks, and playbooks — for any MCP client.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: Concepts
      link: /guide/concepts
    - theme: alt
      text: View on GitHub
      link: https://github.com/rhozacc/prudent-mcp
features:
  - title: Four typed surfaces
    details: Regulation, Tests, Checks, Playbooks — each with its own URI scheme and compile-time ID segregation.
  - title: Read-only knowledge layer
    details: Describes what regulation says and what a test measures. No execution, no writes, no orchestration.
  - title: Traceable to law
    details: Every check carries derived_from RegulationId[] — a typed chain from supervisor expectation back to CRR or EBA GL.
  - title: Traversal & audit tools
    details: expand_playbook, get_area_overview, and get_regulation_tree assemble multi-surface views in one call; get_coverage_gaps flags law with no validation check.
---

<div class="home-narrative">

## Why this exists

Validating an IRB model means cross-referencing a bank's documentation against a moving target: CRR articles, EBA guidelines, ECB guides, supervisor commentary, and statistical methodology. An LLM is well-suited to that cross-referencing — but only if it has **structured access to the source material** rather than relying on training-data recall.

`prudent-mcp` is that source layer. Four surfaces, four URI schemes, typed end-to-end.

## How a question flows through it

A high-level analyst question becomes a chain of typed tool calls against the corpus, then a synthesis grounded in primary sources.

<div class="flow">
  <div class="flow-step">
    <div class="flow-tag">1 · Analyst</div>
    <div class="flow-body">"Walk this PD model and tell me what's broken."</div>
  </div>
  <div class="flow-arrow">↓</div>
  <div class="flow-step">
    <div class="flow-tag">2 · Claude · MCP tool calls</div>
    <div class="flow-body">
      <code>list_review_areas</code> →
      <code>get_area_overview("calibration.pd")</code> →
      <code>search_tests("calibration")</code> →
      <code>get_check ×3</code> →
      <code>get_referrers</code>
    </div>
  </div>
  <div class="flow-arrow">↓</div>
  <div class="flow-step">
    <div class="flow-tag">3 · Typed URIs returned</div>
    <div class="flow-body">
      <code>regulation://crr/180/1/a</code><br>
      <code>regulation://eba/gl-2017-16/84</code><br>
      <code>check://moc/categorisation</code><br>
      <code>test://hosmer-lemeshow</code><br>
      <code>playbook://calibration/pd</code>
    </div>
  </div>
  <div class="flow-arrow">↓</div>
  <div class="flow-step">
    <div class="flow-tag">4 · Synthesis</div>
    <div class="flow-body">5 findings ranked by severity, each tied to a regulation and check URI.</div>
  </div>
</div>

[See the full chained example →](/examples/#_11-chained-walk-this-pd-model-end-to-end-and-tell-me-what-s-broken)

## Try it in one call

Ask the corpus what's expected for PD calibration. One MCP tool call returns the regulations, the operational checks, the relevant tests, and the playbook — fully expanded, in one round-trip:

```jsonc
// MCP request — sent by Claude (or any MCP client)
{
  "name": "get_area_overview",
  "arguments": {
    "area": "calibration.pd"
  }
}
```

```jsonc
// Response — every reference resolved inline
{
  "area": {
    "id": "calibration.pd",
    "name": "PD Calibration",
    "parent": "calibration"
  },
  "regulations": [
    {
      "id": "regulation://crr/180/1/a",
      "citation": "CRR Article 180(1)(a)",
      "text": "Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates."
    },
    {
      "id": "regulation://eba/gl-2017-16/78",
      "citation": "EBA GL 2017/16 para 78",
      "text": "The historical observation period used for PD estimation shall cover at least one full economic cycle..."
    }
  ],
  "checks": [
    {
      "id": "check://calibration/pd/lra-derived",
      "expectation": "PD long-run average is computed over a period containing at least one full economic cycle, with a minimum of five years of default data.",
      "derived_from": [
        "regulation://crr/180/1/a",
        "regulation://eba/gl-2017-16/78"
      ]
    }
  ],
  "tests": [
    {
      "id": "test://jeffreys",
      "name": "Jeffreys test",
      "family": "calibration-binomial",
      "acceptance_criteria": "Posterior probability that the true PD exceeds the estimate is below the chosen significance level."
    }
  ],
  "playbooks": [
    {
      "id": "playbook://calibration/pd",
      "phases": ["Validate LRA derivation", "Test calibration at grade level"]
    }
  ]
}
```

That single payload is enough for the model to produce a defensible finding: an expectation, the law it derives from, the test that proves it, and the playbook phase it fits into.

## What you wire up

The server is the read-only knowledge layer. You bring the corpus through an adapter; the MCP surfaces it through tools, resources, and prompts that any client (Claude Desktop, Claude Code, Cursor, custom integrations) understands.

</div>

<style>
.home-narrative {
  max-width: 920px;
  margin: 3rem auto 0;
  padding: 0 24px 4rem;
}
.home-narrative h2 {
  font-family: var(--prudent-font-display, Georgia, serif);
  font-weight: 400;
  font-size: clamp(1.6rem, 2.4vw, 2rem);
  letter-spacing: -0.01em;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 2rem;
  margin-top: 3rem;
}

/* Stacked flow diagram */
.flow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  margin: 2rem auto;
  max-width: 720px;
}
.flow-step {
  border: 1px solid var(--vp-c-divider);
  border-left: 3px solid var(--prudent-blue, #3A58FF);
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  padding: 14px 18px;
}
.flow-tag {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--prudent-blue, #3A58FF);
  margin-bottom: 6px;
}
.flow-body {
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--vp-c-text-1);
}
.flow-body code {
  font-size: 0.85em;
  background: var(--prudent-blue-soft, #EEF1FF);
  color: var(--prudent-blue, #3A58FF);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  margin: 1px 2px;
  display: inline-block;
}
.flow-arrow {
  text-align: center;
  color: var(--prudent-blue, #3A58FF);
  font-size: 1.2rem;
  opacity: 0.65;
  line-height: 1;
}
</style>
