# Public beta

Screenwalk is public source beta software, not a public npm package yet.

## What is ready to test

- one-command local scan, capture, Studio launch, and browser open;
- actual desktop/mobile UI on the product map;
- complete inventory, entry-reachable flow, and screen-library views;
- browser-first discovery for Next.js, plain HTML, and client-routed SPAs;
- public plus password-gated access views through bounded setup recipes;
- runtime, reachability, responsive, capture-quality, and coverage findings;
- path playback, screen selection, and copyable agent handoffs;
- watch mode, immutable run manifests, capture hashes, and graph diffs.

## What to expect from a beta

Framework-specific source coverage is strongest for Next.js App Router. Browser capture can work more broadly, but unusual routing, auth, CSP, dynamic data, or browser behavior may require a fixture or bounded recipe. The evidence labels are the contract: Screenwalk should expose uncertainty rather than cosmetically hide it.

## A useful review round

1. Have the builder prepare one bounded capture of a real app.
2. Select a path and review two actual screens.
3. Write a unique **What should change?** and observable **Done when** for each.
4. Copy one change brief to an agent or engineer.
5. Apply the change and rerun the same path, viewport, access state, and conditions.

The repository includes a [structured public-beta issue form](https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml). Do not attach secrets, customer data, or unredacted sensitive captures.

## Not in this beta

Element-level pins, direct code editing, autonomous agent invocation, Figma export, multiplayer review, native mobile capture, and hosted private-code ingestion remain intentionally deferred until the capture and evidence loop is dependable. Screen feedback is currently local to the browser until the reviewer copies a brief.
