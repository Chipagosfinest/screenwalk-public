# Screenwalk architecture

## Pipeline

```text
repo + runtime configuration
        |
        v
framework adapter -----> static evidence ledger
        |                       |
        v                       v
bounded browser explorer -> observed evidence ledger
        |                       |
        +----------+------------+
                   v
          identity + reconciliation
                   |
                   v
     versioned FlowGraph + explicit gaps -----> capture asset cache
            /                  \                         |
           v                    v                        v
 editable workspace        Journey Composition <--------+
           |                       |
           v                       v
 canvas-engine adapter      Player / image / video
```

## Extraction layers

### 1. Framework inventory

For Next.js 16+, prefer the framework's `get_routes` development MCP when available; otherwise read App Router conventions. Record `page`, `loading`, `error`, `not-found`, parallel slots, and intercepted routes separately because one URL can produce multiple visual states.

### 2. Static navigation candidates

Use the TypeScript compiler API or a framework adapter—not regex in production—to find `Link`, redirects, router navigation, middleware gates, and known state-machine transitions. The current regex scanner is deliberately a fixture proof. Dynamic expressions become gaps with source locations.

### 3. Bounded observation

Use Playwright with one-shot contexts and an optional environment-backed setup recipe for a second access view. Collect:

- URL, semantic snapshot, stable interactables, screenshot, console/network outcomes;
- action attempted and resulting state identity;
- trace and source evidence needed to reproduce;
- explicit budgets for steps, depth, time, and breadth.

Automatic discovery follows visible same-origin anchors within explicit depth and screen budgets. It does not submit forms or click arbitrary controls. Routes whose names suggest logout, deletion, checkout, purchase, or unsubscribe are withheld. The narrow current exception is a versioned setup recipe: accessibility-targeted fill, click, and route-wait actions may establish an access session in a fresh context, with fill values resolved from environment-variable names rather than stored secrets.

### 4. Identity and reconciliation

The identity model must separate:

- stable structural signals: route pattern, landmark/heading/role tree, component/source anchors;
- dimensions: persona, viewport, feature configuration;
- volatile content: timestamps, random IDs, balances, list data, animation frames;
- meaningful state: modal open, empty/error/loading/success, wizard step, permission gate.

Never collapse static and observed evidence. A static candidate verified at runtime gains a second receipt; it does not overwrite provenance.

## Graph and composition contract

`FlowGraph` is canonical. `FlowComposition` references an ordered subset of node IDs plus render metadata. Playback accepts only serializable props so the same input can power an embedded player and later server-side render.

Canvas coordinates, groups, pins, and human notes belong to a separate workspace document keyed by stable graph IDs. Rescanning can update evidence without destroying human organization. The canvas engine stays behind an adapter: React Flow proves the graph today; tldraw is the leading rich-canvas candidate, but its production license and long-term coupling require an explicit business decision.

Captured UI is the default canvas and playback source. A live localhost target is a focused inspection mode only: many simultaneous iframes are nondeterministic, expensive, auth/CSP-sensitive, and unsuitable as render inputs. Uncaptured nodes render an honest missing-evidence state, never generated substitute UI.

Diagnostics are evidence records with time, phase, severity, URL, and optional node/edge attribution. Attribution means “active during observation,” not proven causality. Build, console, page, request, and HTTP failures remain filterable and retain their raw provenance.

Motion maps to semantic events:

- transition begins when an edge action fires;
- screen settles when the target state is observed;
- branch choice is visible and reversible in the studio;
- reduced-motion mode swaps interpolation for direct cuts;
- polling and rescans never replay entrance motion.

## Figma boundary

The Figma REST file endpoints read/export documents. Creating editable frames, connectors, and image fills requires a Figma plugin running with the `figma` global API. Therefore Figma is a later adapter that imports a signed graph artifact; it is not the canonical database or the first renderer.

## Security boundary

- local-first analysis by default;
- reusable credential values remain in the command environment and outside prompts, recipes, graphs, logs, screenshots, and committed artifacts;
- redact cookies, authorization headers, query secrets, and captured personal data;
- same-origin allowlist and SSRF protections for crawling;
- hard limits and explicit skipped-action receipts;
- no claim of completeness: report observed, static-only, declared, inferred, and unknown separately.
