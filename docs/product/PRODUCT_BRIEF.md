# Screenwalk product brief

> **Map the UI you actually built.**

## Customer and painful job

The first customer is a solo builder or small team using a coding agent who has a working local UI but loses time turning visual review into precise implementation instructions and checking the next round. Designers, QA partners, and engineering leads are adjacent reviewers, not separate initial products.

Their painful job is not “draw a user flow.” It is: **point at the exact screen or branch, preserve route/source/state/condition context, state the edit and what done means, hand it to the agent, and verify the next implementation round without reopening every route manually.**

The outcome is fewer description cycles and less regression risk. The core loop is: **Capture → Orient → Critique → Handoff → Change → Rerun.** The map is useful when it makes that round faster and more trustworthy; it is not the product by itself.

## Product thesis

Screenwalk is a compiler from application evidence to two views of the same truth:

1. a spatial screen-and-branch graph for comprehension;
2. a deterministic journey composition for playback, scrubbing, sharing, and eventual rendering.

The Remotion analogy is structural, not decorative:

- application evidence is source code;
- a journey is a composition with stable identity and serializable props;
- the studio previews the result interactively;
- image/video/Figma artifacts are compiled outputs;
- the canonical representation stays local, versioned, and diffable.

Actual application UI is a product invariant. A node may show a deterministic browser capture, a clearly labeled live-local inspection, or an explicit uncaptured state. It must never substitute a polished synthetic mockup and imply that the app was observed.

## MVP promise

> Point Screenwalk at a web repo and its running UI. Review captured screens in path context, write screen-specific changes with observable acceptance criteria, copy one evidence-backed brief to your agent, then rerun the same conditions to check the result. Unproven states stay labeled.

## The review round

1. **Capture:** record the actual UI Screenwalk can safely reach.
2. **Orient:** choose one path and read its viewport, environment, access state, and recorded conditions.
3. **Critique:** attach a unique change request and observable `Done when` to exact screens.
4. **Handoff:** copy the selected screens, routes, source files, conditions, and evidence to an existing coding agent or engineer.
5. **Change and rerun:** make the smallest defensible edit, repeat the same context, and check the acceptance criteria.

Navigation, conditions, and deployment context remain separate concepts: an edge names the action between screens; an `If` label states when it exists; the environment/revision states where it was observed. Feature flags and A/B variants are explicit named conditions or journeys, not an exhaustive generated matrix.

## Core objects

- **Screen state**: route + persona + viewport + meaningful semantic/visual fingerprint.
- **Transition**: action from one screen state to another, with condition and evidence.
- **Gap**: unresolved or unobserved state/edge; never silently treated as absence.
- **Journey**: an ordered path through the graph.
- **Composition**: render metadata plus a journey, suitable for interactive playback and deterministic export.
- **Snapshot**: graph at a git SHA/configuration, used for diffs.
- **Capture bundle**: screenshot or frame sequence plus URL, viewport, time, DOM/accessibility evidence, and runtime diagnostics.
- **Workspace**: editable layout, grouping, and notes keyed to stable graph IDs; never mixed into machine-observed evidence.

## MVP scope

Include:

- Next.js App Router source inventory;
- browser-first multi-page HTML and client-routed SPA discovery;
- filesystem route inventory;
- static `Link`, redirect, push, and replace candidates;
- one public and optionally one recipe-established access view;
- read-only bounded Playwright verification;
- evidence/confidence/gaps;
- separately captured desktop/mobile screenshot-first canvas;
- graph-to-composition playback;
- graph snapshots, immutable manifests, and diff contract;
- selected-screen and finding handoff to an existing coding agent.
- recipe-driven capture of meaningful modal, drawer, and popover states;
- screen-specific critique and observable acceptance criteria;
- a same-context rerun instruction in every copied change brief;
- a public-beta feedback path and local-only privacy boundary.

Defer:

- Figma plugin;
- native mobile capture and additional source-level framework adapters;
- autonomous form submission or mutable actions;
- broad persona/viewport matrices;
- AI-generated product advice;
- cloud collaboration and hosted private-code ingestion.
- element-level feedback pins and threads, direct agent invocation, and hosted share workflows until runtime capture and state identity are trustworthy.

## Product risks

1. **Trust failure**: visually polished but wrong or incomplete graphs become disposable sitemaps.
2. **Identity instability**: data churn creates false screen changes; loose fingerprints merge meaningful states.
3. **Setup cliff**: auth, fixtures, flags, and seed data make first value too slow.
4. **Occasional-use trap**: users like the first scan but have no recurring job.
5. **Commoditization**: route maps, screenshots, and graph canvases are already easy to reproduce.
6. **Handoff placebo**: the copied brief looks structured but does not improve the next implementation round over a screenshot and prose.

## Validation gates

1. Observe 3–5 outside builders or designer-builder pairs installing or receiving a prepared capture. Record time to first useful review and the first misleading claim.
2. Require one real critique, copied brief, agent-driven code change, and same-context rerun. Check whether the acceptance criteria were actually verifiable.
3. Compare the handoff with the team's normal screenshot, Loom, Figma comment, or prose prompt. Structure alone is not improvement.
4. Repeat scans across data changes; structurally unchanged states should retain identity while a deliberate UI structure change should surface.
5. Ask whether the user voluntarily reruns Screenwalk after the next UI edit and whether they would pay for an audit/diff pilot.

If 3–5 outside testers cannot complete a real change round or do not want to rerun it, stop expanding the scanner and canvas. Reconsider the product before adding more surface area.
