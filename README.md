# Screenwalk

[![CI](https://github.com/Chipagosfinest/screenwalk-public/actions/workflows/ci.yml/badge.svg)](https://github.com/Chipagosfinest/screenwalk-public/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/screenwalk)](https://www.npmjs.com/package/screenwalk)
[![npm downloads](https://img.shields.io/npm/dw/screenwalk)](https://www.npmjs.com/package/screenwalk)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178c6)](https://www.typescriptlang.org/)

**See the product you actually built. Review it as a whole. Change it with precision.**

Screenwalk turns a web repository and its running UI into a shared, reviewable map of real screens and paths. It shows what the browser opened, what the code suggests, and what remains unproven. A builder or designer can point to an exact screen, write a specific critique and an observable **Done when**, then copy one evidence-rich change brief to a coding agent or engineer.

After the change, run Screenwalk again under the same conditions and check the result.

![Screenwalk Studio mapping a synthetic captured UI into product paths and an agent-ready change brief](docs/assets/screenwalk-studio.png)

[Live demo](https://screenwalk.app) · [Documentation](https://screenwalk.dev) · [Quickstart](https://screenwalk.dev/guide/quickstart) · [Designer test](docs/testing/FIRST_TESTERS.md) · [Public beta](https://screenwalk.dev/beta)

## Why Screenwalk

AI can add UI faster than anyone can keep the whole product in their head. A route list does not show what rendered. A screenshot does not explain how someone arrived there. A review comment without route, state, viewport, or source context makes the next agent guess.

Screenwalk closes that loop:

1. **Capture:** open the UI Screenwalk can safely reach from a running app.
2. **Orient:** see screens in path context across desktop, mobile, access states, and recorded conditions.
3. **Critique:** attach a unique change request and observable acceptance criteria to exact screens.
4. **Handoff:** copy a clean brief with routes, source files, path, viewport, conditions, and evidence.
5. **Rerun:** review the same path after the implementation round.

It can also help you find “zombie UI”: old screens, hidden branches, and forgotten flows still exposed by the codebase. Screenwalk calls these **unconnected** or **unproven**, not dead. A direct link, flag, sign-in state, or missing recipe may still make them intentional.

## Get started

Keep the target app running, then execute Screenwalk from npm:

```bash
npx screenwalk /absolute/path/to/app --url http://127.0.0.1:3000
```

The verified environment is Node.js 22.14 or newer with Chromium or Chrome available. Screenwalk does not upload the target app, replace its dev server, submit arbitrary forms, or click consequential actions. pnpm users can run the same package with `pnpm dlx screenwalk`.

If capture cannot start:

```bash
npx screenwalk doctor /absolute/path/to/app --url http://127.0.0.1:3000
```

For a known-good first run:

```bash
# Run against any already-running local app
npx screenwalk /absolute/path/to/app --url http://127.0.0.1:3000
```

## Review one real change

When Studio opens:

1. Read **N of M screens opened**. This is runtime evidence, not every route found in code.
2. Choose **Map** for relationships or **Screens** for the visual inventory.
3. Select a path and choose **Play** to review it screen by screen.
4. Click a screen. Write **What should change?** and an observable **Done when**.
5. Repeat for one related screen, then choose **Copy change brief**.
6. Give the brief to your coding agent or engineer, apply the change, and rerun the same path and context.
7. Open **Things to check** for anything Screenwalk could not confirm.

Screenwalk currently supports written critique attached to a whole screen. It does not yet provide element-level pins, multiplayer comments, a hosted share URL, or direct agent invocation. Notes stay in that browser until you copy the brief.

## Read relationships without graph soup

- `Screen — action → Screen` answers what connects two screens.
- An `If …` label answers when that connection exists, such as signed-in access, a feature flag, an experiment variant, or a data state.
- The environment and revision identify where Screenwalk observed the UI. Production and staging are comparison contexts, not extra flow branches.

Feature flags and A/B variants require explicit recipes so Screenwalk can record each named condition independently. It does not enumerate provider targeting rules or generate an exhaustive flag matrix.

For a monorepo or deployed environment:

```bash
npx screenwalk inspect /absolute/path/to/repository --out /tmp/screenwalk-topology.json
npx screenwalk /absolute/path/to/repository \
  --url https://staging.example.com \
  --service apps-web \
  --environment staging
```

If more than one browser surface exists, Screenwalk refuses to guess and lists valid `--service` choices. Topology signals are discovery evidence, not proof that an integration, service, or flag is active at runtime.

## Current boundary

Screenwalk is ready to test on Next.js App Router, plain HTML, client-routed SPAs, and bounded password-gated views. Next.js has the deepest source understanding; browser capture is broader. Automatic discovery is capped at 30 screens, one link depth, and safe same-origin anchors. It does not claim to render every possible state or prove that every discovered screen is intended.

Deferred: arbitrary form submission, CAPTCHA/MFA/OAuth consent, native mobile capture, Figma export, hosted private-code ingestion, and autonomous fixes.

## Help test it

Start with the [15-minute designer test](docs/testing/FIRST_TESTERS.md). Blunt feedback is more valuable than a polished demo. If a map is misleading, the install fails, or the copied brief does not help a real change, use the [public-beta feedback form](https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml).

Do not attach secrets, customer data, `.env` contents, or unredacted sensitive screenshots. See [CONTRIBUTING.md](CONTRIBUTING.md) for reviewable changes and [SECURITY.md](SECURITY.md) for private vulnerability reports.

## Develop and verify

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm certify:beta
pnpm verify:clean
pnpm verify:package
```

Every release is gated by `pnpm verify:package`, which installs the packed artifact outside the monorepo and runs a real browser capture plus packaged Studio check. The source repository is available under the [MIT License](LICENSE).
