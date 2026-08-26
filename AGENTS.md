# Screenwalk project instructions

- Treat the evidence ledger as the product contract. Never present inferred coverage as observed coverage.
- Keep the first extractor Next.js App Router-only until precision and recall are measured.
- Browser exploration is read-only by default. A bounded `--setup` recipe may establish a local/preview access session from environment-backed values. Purchases, deletes, publishing, CAPTCHA, MFA, OAuth consent, and other consequential actions still require human handoff or explicit approval.
- A screen is a rendered state, not merely a URL. Identity must account for persona and meaningful UI state while resisting content-data churn.
- The graph and playback composition share one versioned schema. The local studio is canonical; exports are derived artifacts.
- Preserve reduced-motion behavior and do not replay entrance motion on polling or re-render.

## Agent workflow

1. Read `README.md`, `llms.txt`, and the relevant contract in `packages/schema/src/index.ts` before changing extraction or capture behavior.
2. Keep the target application running separately; do not terminate or replace an existing dev server. Choose another port when needed.
3. Start with bounded discovery: `pnpm screenwalk /path/to/app --url http://127.0.0.1:3000 --no-open`. Increase `--discover-depth` only when one-hop evidence is insufficient.
4. Treat screenshots as captured observations, not a live render. Use `--watch` for source-triggered recapture; the last good graph remains canonical until a new capture completes.
5. When an app has a password or test-login wall, keep the public capture and add `--setup <recipe.json>` for the allowed view. Recipes may name environment variables through `valueFromEnv`; never place a credential value or reusable browser state in a recipe, graph, log, or repository.
6. Use the Studio's findings drawer to copy an evidence bundle or agent prompt. Reproduce a finding before fixing it, group repeated symptoms by root cause, and do not suppress diagnostics as a substitute for a fix.
7. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before handing work back.
8. When tuning capture performance, add `--timing-json /tmp/screenwalk-timings.json` and compare useful-screen counts, observed-transition sets, and screenshot fidelity before accepting a faster run.

## Current boundaries

- Safe same-origin links are explored. Forms and consequential actions are not submitted during automatic discovery; the bounded access setup is the only form-submission exception.
- Dynamic route templates need a concrete observed URL or an explicit recipe.
- Desktop and mobile captures are separate evidence variants. Header chrome, Sign in, and other shell controls are not enough to mark a capture `ready`; wait for the main product surface, then keep `loading` or `empty` if it never appears.
- Repeated runtime diagnostics that differ only by request ids or query strings are one counted finding, not a unique error per URL.
- Public and allowed access views are separate evidence personas; switching views never upgrades a public observation into an authenticated one.
- Watch mode maps known source files to routes, recaptures those routes, and falls back to a full refresh for unknown source changes.
- Multi-project workspace discovery, hosted sharing, editing, Figma, and broad framework adapters are deferred until the capture loop is dependable.
