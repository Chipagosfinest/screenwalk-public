# Carry a review into the next round

Screenwalk shortens the loop between seeing a UI problem, describing the intended result, and giving a person or coding agent enough context to produce the next version.

## Hand off selected screens

1. Choose **Select screens**.
2. Click screens on the canvas or in the screen library.
3. Open a selected screen's details and add **What should change?** and **Done when**.
4. Copy routes and source files for a compact reference, or copy the full change brief.

The change brief preserves:

- selected routes and screen identities;
- source locations when available;
- the selected flow, current access view, viewport, and recorded conditions;
- capture and reachability evidence;
- a unique requested change and acceptance criterion for each reviewed screen;
- the warning that unconnected is not equivalent to dead.

The same Markdown is intended to work as a design-QA brief, an implementation checklist, or a prompt pasted into the coding agent you already use. Screenwalk does not maintain separate human and agent documents that can drift.

## Hand off findings

Open **Review findings**, narrow the evidence if needed, and choose **Copy agent prompt**. This is useful for runtime errors, missing mobile captures, unreachable states, and failed requests that are easier to fix with the affected route already named.

## Close the round

After the implementation changes, rerun the same journey under the same viewport, access context, and conditions. Check each **Done when** result and keep the journey receipt with the next review. One passing branch does not verify its alternate variant.

## Give an agent the repository contract

Repository-aware agents should read these files before modifying Screenwalk:

- `AGENTS.md` for safe operating rules;
- `llms.txt` for a compact system map;
- `skills/screenwalk/SKILL.md` for the reusable workflow and verification commands.

Screenwalk does not invoke an agent, edit the target application, manage feature flags, or replace a ticket system. Today it produces one bounded change brief that you can paste into an agent or share with the people reviewing the implementation.
