# Screenwalk brand lock

## Canonical name

**Screenwalk**

Use `Screenwalk` in product UI, documentation, launch copy, screenshots, and human-facing CLI output. Use `screenwalk` for the canonical command and eventual package name.

## Canonical positioning

> **See the product you actually built. Review it as a whole. Change it with precision.**

This is the product promise. Shorter campaign lines may emphasize one discovery job—such as **Find the zombie UI**—but must not imply that Screenwalk proves a screen is dead or captures every possible state.

## Meaning

Screenwalk is an active walkthrough, not a static sitemap. The name should imply moving through real rendered screens with the builder, seeing what connects, and stopping where evidence runs out.

## Compatibility boundary

The following are implementation identifiers and may remain during the rename:

- `screenbranch.*.v0` schema versions;
- `@screenbranch/*` private workspace package scopes;
- `screenbranch.graph.json` and `.screenbranch` storage paths;
- `screenbranch` as a temporary CLI alias.

Do not surface those identifiers as the product name. Rename or migrate them only with explicit versioning and backward-compatibility work.

## Visual and interaction direction

Warm-minimal, legible, and evidence-first. The canvas should feel explorable without turning into a decorative system diagram. Playback controls, hierarchy, and contextual explanation should help someone move screen by screen and understand why each connection exists.
