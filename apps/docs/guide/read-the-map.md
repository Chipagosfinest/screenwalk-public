# Read your product map

The map is designed to answer three different questions without making you learn three tools.

## All screens: what exists?

**All screens** is the default. It keeps captured, source-only, unconnected, and alternate-state nodes visible so the most important surprise is not hidden by a “happy path” filter.

Use it to find:

- routes left behind by an earlier product iteration;
- admin or deep-linked screens with no observed entry path;
- code states that were discovered but could not be rendered;
- desktop/mobile capture differences and runtime failures.

## From Home: what can a visitor reach?

**From Home** narrows the canvas to evidence-backed paths beginning at `/`. Click a screen to isolate the branches around it, then use the path rail to move through the experience.

Reachability is scoped to the current access view. A public visitor and an allowed preview session can have different graphs without either one overwriting the other.

## Screen library: what does the product look like?

**Screen library** removes topology from the foreground and makes the capture inventory easy to scan. Switch **Desktop / Mobile** and **Actual UI / Routes** without changing the evidence set.

## Unconnected does not mean dead

An unconnected route has no path from the current entry screen in current evidence. It may be:

- dead code;
- intentionally deep-linked;
- protected by authentication;
- parameterized and missing a concrete URL;
- reachable through an interaction Screenwalk intentionally did not perform;
- simply beyond the current discovery depth.

Treat it as a review candidate, never an automatic deletion instruction.

## Findings are receipts, not verdicts

Open **Review findings** to filter and scroll through reachability, runtime, responsive, capture-quality, and coverage evidence. Copy one item, all visible items, or an agent-ready prompt that preserves the relevant routes and source files.
