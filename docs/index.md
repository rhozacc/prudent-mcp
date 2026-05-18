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
  - title: Traversal tools
    details: expand_playbook and get_area_overview assemble multi-surface views in one call, eliminating N+1 fetches.
---

<div style="max-width: 960px; margin: 3rem auto 0; padding: 0 24px;">

## What it looks like in use

A high-level analyst question becomes a chain of typed tool calls against the corpus, then a synthesis grounded in primary sources.

<svg viewBox="0 0 920 360" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;color:var(--vp-c-text-1);">
  <style>
    .lane    { fill: var(--vp-c-bg-soft); stroke: currentColor; stroke-width: 1; opacity: 0.6; }
    .laneTxt { fill: currentColor; font: 600 12px ui-sans-serif, system-ui, sans-serif; opacity: 0.7; }
    .step    { fill: var(--vp-c-bg-alt); stroke: currentColor; stroke-width: 1.4; }
    .stepTxt { fill: currentColor; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .cap     { fill: currentColor; font: 400 11px ui-sans-serif, system-ui, sans-serif; opacity: 0.75; }
    .arrow   { stroke: currentColor; stroke-width: 1.2; fill: none; marker-end: url(#hh); opacity: 0.55; }
    .bigArrow{ stroke: currentColor; stroke-width: 2;   fill: none; marker-end: url(#hh); }
  </style>
  <defs>
    <marker id="hh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect class="lane" x="10"  y="40" width="180" height="280" rx="6"/>
  <text class="laneTxt" x="100" y="62" text-anchor="middle">Analyst</text>
  <rect class="lane" x="200" y="40" width="500" height="280" rx="6"/>
  <text class="laneTxt" x="450" y="62" text-anchor="middle">Claude · MCP tool calls</text>
  <rect class="lane" x="710" y="40" width="200" height="280" rx="6"/>
  <text class="laneTxt" x="810" y="62" text-anchor="middle">Synthesis</text>
  <rect class="step" x="20" y="100" width="160" height="56" rx="6"/>
  <text class="cap" x="100" y="124" text-anchor="middle">"Walk this PD model</text>
  <text class="cap" x="100" y="140" text-anchor="middle">and tell me what's broken"</text>
  <rect class="step" x="220" y="92"  width="200" height="32" rx="6"/>
  <text class="stepTxt" x="320" y="113" text-anchor="middle">list_review_areas</text>
  <rect class="step" x="220" y="138" width="200" height="32" rx="6"/>
  <text class="stepTxt" x="320" y="159" text-anchor="middle">get_area_overview</text>
  <rect class="step" x="220" y="184" width="200" height="32" rx="6"/>
  <text class="stepTxt" x="320" y="205" text-anchor="middle">search_tests</text>
  <rect class="step" x="220" y="230" width="200" height="32" rx="6"/>
  <text class="stepTxt" x="320" y="251" text-anchor="middle">get_check ×3</text>
  <rect class="step" x="220" y="276" width="200" height="32" rx="6"/>
  <text class="stepTxt" x="320" y="297" text-anchor="middle">get_referrers</text>
  <rect class="step" x="460" y="92"  width="220" height="32" rx="6"/>
  <text class="stepTxt" x="570" y="113" text-anchor="middle">regulation://crr/180/1/a</text>
  <rect class="step" x="460" y="138" width="220" height="32" rx="6"/>
  <text class="stepTxt" x="570" y="159" text-anchor="middle">regulation://eba/gl-2017-16/84</text>
  <rect class="step" x="460" y="184" width="220" height="32" rx="6"/>
  <text class="stepTxt" x="570" y="205" text-anchor="middle">check://moc/categorisation</text>
  <rect class="step" x="460" y="230" width="220" height="32" rx="6"/>
  <text class="stepTxt" x="570" y="251" text-anchor="middle">test://hosmer-lemeshow</text>
  <rect class="step" x="460" y="276" width="220" height="32" rx="6"/>
  <text class="stepTxt" x="570" y="297" text-anchor="middle">playbook://calibration/pd</text>
  <rect class="step" x="720" y="140" width="180" height="80" rx="6"/>
  <text class="cap" x="810" y="166" text-anchor="middle">5 findings ranked</text>
  <text class="cap" x="810" y="182" text-anchor="middle">by severity, each</text>
  <text class="cap" x="810" y="198" text-anchor="middle">tied to a regulation</text>
  <text class="cap" x="810" y="214" text-anchor="middle">and check URI</text>
  <path class="bigArrow" d="M180,128 L220,108"/>
  <path class="arrow"    d="M420,108 L460,108"/>
  <path class="arrow"    d="M420,154 L460,154"/>
  <path class="arrow"    d="M420,200 L460,200"/>
  <path class="arrow"    d="M420,246 L460,246"/>
  <path class="arrow"    d="M420,292 L460,292"/>
  <path class="bigArrow" d="M680,200 L720,180"/>
</svg>

See the [full chained example](/examples/#_11-chained-walk-this-pd-model-end-to-end-and-tell-me-what-s-broken) for the prompts, the responses, and the synthesised finding list.

</div>
