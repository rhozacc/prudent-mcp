# Tools overview

14 tools across six files. Every tool has a description, a zod input schema, and a handler that delegates to the adapter layer.

## All tools

| Tool | Surface | Description |
|---|---|---|
| `get_corpus_info` | meta | What's loaded — counts and coverage |
| `get_referrers` | meta | Everything that references a given ID |
| `resolve_citation` | meta | Loose prose citation → structured Regulation |
| `list_review_areas` | meta | Canonical taxonomy of review areas |
| `expand_playbook` | meta | Playbook with all Phase.references resolved inline |
| `get_area_overview` | meta | One-shot entry point: area node + expanded playbooks + deduplicated IDs |
| `search_regulation` | regulation | Full-text search across all loaded regulatory frameworks |
| `get_regulation` | regulation | Fetch a regulation paragraph by URI, with optional `as_of` |
| `search_tests` | tests | Full-text search across the statistical test catalog |
| `get_test` | tests | Fetch a test by ID |
| `search_checks` | checks | Full-text search across the qualitative check catalog |
| `get_check` | checks | Fetch a check by ID |
| `search_playbooks` | playbooks | Full-text search across the playbook catalog |
| `get_playbook` | playbooks | Fetch a playbook by ID |

## URI scheme quick-reference

```
regulation://{framework}/{article}[/{paragraph}[/{point}]]
  e.g.  regulation://crr/178/1/a
        regulation://eba/gl-2017-16/78

test://{test-id}
  e.g.  test://jeffreys
        test://hosmer-lemeshow

check://{area}/{topic}[/{specific}]
  e.g.  check://calibration/pd/lra-derived
        check://default-definition/utp

playbook://{area}[/{subarea}]
  e.g.  playbook://calibration/pd
        playbook://default-definition
```

## Workflow patterns

**Starting a review area:** `list_review_areas` → confirm slug → `get_area_overview` → work through expanded phases.

**Resolving a bank citation:** `resolve_citation("Art. 178(1)(a)")` → `get_regulation` → `get_referrers` → checks + playbooks.

**Checking test equivalence:** `search_tests("chi-squared decile")` → compare `family` field → read `acceptance_criteria`.

**Historical regulation lookup:** `get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")` → see what was in force when the model was built.

## Which tool, when?

<svg viewBox="0 0 760 360" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;color:var(--vp-c-text-1);">
  <style>
    .q     { fill: var(--vp-c-bg-soft); stroke: currentColor; stroke-width: 1.5; }
    .a     { fill: var(--vp-c-bg-alt); stroke: currentColor; stroke-width: 1.5; }
    .qTxt  { fill: currentColor; font: 500 12px ui-sans-serif, system-ui, sans-serif; }
    .aTxt  { fill: currentColor; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .edge  { stroke: currentColor; stroke-width: 1.2; fill: none; marker-end: url(#et); opacity: 0.6; }
    .edgeL { fill: currentColor; font: 500 11px ui-sans-serif, system-ui, sans-serif; opacity: 0.7; }
  </style>
  <defs>
    <marker id="et" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="currentColor"/>
    </marker>
  </defs>
  <rect class="q" x="280" y="20" width="200" height="44" rx="22"/>
  <text class="qTxt" x="380" y="38" text-anchor="middle">Starting point?</text>
  <text class="qTxt" x="380" y="54" text-anchor="middle">(what do you have)</text>
  <rect class="q" x="20"  y="110" width="180" height="44" rx="22"/>
  <text class="qTxt" x="110" y="138" text-anchor="middle">A review task</text>
  <rect class="q" x="220" y="110" width="180" height="44" rx="22"/>
  <text class="qTxt" x="310" y="138" text-anchor="middle">A prose citation</text>
  <rect class="q" x="420" y="110" width="180" height="44" rx="22"/>
  <text class="qTxt" x="510" y="138" text-anchor="middle">A bank's test name</text>
  <rect class="q" x="620" y="110" width="120" height="44" rx="22"/>
  <text class="qTxt" x="680" y="138" text-anchor="middle">A finding</text>
  <rect class="a" x="20"  y="200" width="180" height="40" rx="6"/>
  <text class="aTxt" x="110" y="225" text-anchor="middle">list_review_areas</text>
  <rect class="a" x="20"  y="252" width="180" height="40" rx="6"/>
  <text class="aTxt" x="110" y="277" text-anchor="middle">get_area_overview</text>
  <rect class="a" x="220" y="200" width="180" height="40" rx="6"/>
  <text class="aTxt" x="310" y="225" text-anchor="middle">resolve_citation</text>
  <rect class="a" x="220" y="252" width="180" height="40" rx="6"/>
  <text class="aTxt" x="310" y="277" text-anchor="middle">get_regulation</text>
  <rect class="a" x="220" y="304" width="180" height="40" rx="6"/>
  <text class="aTxt" x="310" y="329" text-anchor="middle">get_referrers</text>
  <rect class="a" x="420" y="200" width="180" height="40" rx="6"/>
  <text class="aTxt" x="510" y="225" text-anchor="middle">search_tests</text>
  <rect class="a" x="420" y="252" width="180" height="40" rx="6"/>
  <text class="aTxt" x="510" y="277" text-anchor="middle">get_test (family)</text>
  <rect class="a" x="620" y="200" width="120" height="40" rx="6"/>
  <text class="aTxt" x="680" y="225" text-anchor="middle">search_checks</text>
  <rect class="a" x="620" y="252" width="120" height="40" rx="6"/>
  <text class="aTxt" x="680" y="277" text-anchor="middle">resolve_citation</text>
  <path class="edge" d="M340,64 L130,110"/>
  <path class="edge" d="M375,64 L310,110"/>
  <path class="edge" d="M410,64 L490,110"/>
  <path class="edge" d="M445,64 L660,110"/>
  <path class="edge" d="M110,154 L110,200"/>
  <path class="edge" d="M110,240 L110,252"/>
  <path class="edge" d="M310,154 L310,200"/>
  <path class="edge" d="M310,240 L310,252"/>
  <path class="edge" d="M310,292 L310,304"/>
  <path class="edge" d="M510,154 L510,200"/>
  <path class="edge" d="M510,240 L510,252"/>
  <path class="edge" d="M680,154 L680,200"/>
  <path class="edge" d="M680,240 L680,252"/>
</svg>

Reading the tree top-down: ask what you have, follow the branch, run the tool. Most chains stop after one or two more calls — `get_referrers` after a regulation, `get_test` after a search hit, `expand_playbook` after `get_area_overview` if you skipped the overview.
