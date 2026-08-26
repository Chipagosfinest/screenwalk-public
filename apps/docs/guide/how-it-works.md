# How Screenwalk works

Screenwalk compiles application evidence into two views of the same product: a spatial map for comprehension and a path player for review.

```text
repository + running localhost
        ↓
source inventory + safe browser discovery
        ↓
captured desktop/mobile states + observed transitions
        ↓
versioned graph + explicit gaps
        ↓
local Studio, playback, findings, and agent handoff
```

## Connect

Screenwalk verifies the project path, running URL, browser, output directory, and optional access recipe. The target app remains owned by you and continues running under its normal dev server.

## Scan

For Next.js App Router projects, Screenwalk inventories filesystem routes and static navigation candidates. For plain HTML and client-routed SPAs, browser discovery is first-class even when no framework adapter or `package.json` exists.

Static evidence is a candidate, not proof that a visitor can reach a screen.

## Capture

A fresh browser context visits known and safely discovered same-origin URLs. Screenwalk records screenshots, rendered links, visible-control inventory, console errors, failed requests, HTTP failures, and capture quality.

Desktop and mobile are separate captures. An uncaptured state stays visible as missing evidence; it is never replaced with generated UI.

## Reconcile

The graph preserves provenance instead of flattening everything into “found”:

- **Static**: discovered in source.
- **Observed**: rendered or followed by the browser.
- **Captured**: a screenshot exists for that access view and viewport.
- **Unobserved**: known without current browser proof.

Screen identity is reconciled at three levels:

- **Family**: canonical route template plus presentation topology, such as standalone page versus modal.
- **Variant**: meaningful query/hash, interaction, lifecycle, or access state beneath that family.
- **Capture context**: persona, viewport, browser, locale, color scheme, motion preference, and network state attached to the evidence.

This keeps twelve product records from becoming twelve screens while preserving meaningful differences such as Billing tab, Admin, login modal, and error state. When Screenwalk cannot prove whether a parameter changes the product experience, Studio says **Review grouping** and includes the uncertainty in the agent handoff.

## Review

Studio opens on the complete product map. You can narrow it to entry-reachable paths, switch actual UI and route views, play a selected path, review evidence, or select screens for an agent handoff.

Screenwalk is intentionally local-first. Runs write versioned graphs and immutable manifests under `output/runs/` so later captures can report added, removed, and changed screens.
