---
name: screenwalk
description: Map, review, and hand off the UI already present in a web codebase using its running localhost. Use for actual desktop/mobile screens, user flows, route states, buried or unreachable routes, runtime diagnostics, evidence gaps, and source-linked prompts for a coding agent.
---

# Screenwalk

## One-prompt outcome

Turn the user's request into this concrete result:

> Map this repository and its running localhost with Screenwalk. Render the actual desktop and mobile UI, connect the entry-reachable user paths, and label every screen and transition as code-only, browser-observed, captured, or unproven. Cite the relevant source file or runtime evidence for every conclusion; never invent a route or call an unconnected route dead. Surface the most actionable gaps, leave Screenwalk Studio open on the complete map, and prepare an evidence-rich prompt for the coding agent.

Do the work directly when the repository and localhost target can be discovered. Ask only for a genuinely missing target URL, access value, or material product decision.

## Run

1. Keep the target application's existing dev server running; never replace or terminate it.
2. Check readiness with `pnpm screenwalk doctor <absolute-project-path> --url <local-url> --json`.
3. Start bounded capture with `pnpm screenwalk <absolute-project-path> --url <local-url> --no-open --watch`.
   - For a password or test-account gate, add `--setup <recipe.json>` and supply every sensitive value through the recipe's `valueFromEnv` field. This preserves both **Public** and the named allowed access view.
4. Open the printed Studio URL and begin in **All screens**. Use **From Home** for entry-reachable branches and **Library** for the capture gallery.
5. Validate an exported graph with `pnpm screenwalk validate <graph.json>`.
6. Leave Studio open. Summarize what rendered, what connects from the entry, what remains unproven, and which screen or path the user should review first.

## Evidence rules

- `static` means source evidence, not runtime reachability.
- `observed` means a browser interaction completed and has a receipt.
- `captured` means a viewport screenshot exists for that run.
- `unobserved-state` means a route state file exists but was not triggered.
- A source file citation explains where a candidate came from; it does not prove that a browser reached it.
- Never submit forms or click destructive, external, purchase, auth-exit, or otherwise consequential controls without an explicit recipe and approval.
- A setup recipe is limited to establishing a local/preview session with fill, click, and route-wait actions. Never store literal credentials or browser storage state. CAPTCHA, MFA, and OAuth consent require human handoff.
- When watch recapture fails, use the last good graph and report the failure; do not represent stale evidence as refreshed.

## Agent handoff

Select the relevant screens or path in Studio and copy its agent prompt. Preserve routes, source files, viewport, access view, incoming and outgoing actions, diagnostics, and evidence labels. Reproduce the affected route first, group duplicates by root cause, make the smallest defensible fix, and verify desktop and mobile. Do not suppress diagnostics in place of fixing their cause.

Do not turn the result into a decorative architecture diagram. Real rendered screens are the primary objects; topology, motion, labels, and summaries must explain evidence that Screenwalk actually collected.
