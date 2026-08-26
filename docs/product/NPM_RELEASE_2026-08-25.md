# Screenwalk npm release decision

Date: 2026-08-25 (America/Los_Angeles)

## Decision

Publish Screenwalk to the npm registry after the CLI is packaged as a clean,
self-contained artifact. Keep pnpm as the repository package manager. One npm
publication supports `npx screenwalk`, `pnpm dlx screenwalk`, and compatible
runners such as `bunx`.

Do not publish the current root package. Its executable relies on pnpm workspace
packages and TypeScript source that work inside this repository but are not a
self-contained installation for users.

## Honest product promise

Screenwalk currently:

- reads a local web codebase and an already-running web application;
- captures desktop and mobile screens plus safely observed transitions;
- opens a local Studio for reviewing the resulting map; and
- creates a structured prompt that can be returned to a coding agent.

It does not currently provide hosted collaboration, Figma import, automatic code
editing, universal authenticated-flow traversal, or guaranteed complete UI
coverage. npm copy and release notes must preserve those boundaries.

## Observed repository evidence

- The unscoped package name `screenwalk` returned `E404` from the npm registry on
  2026-08-25. Availability must be checked again immediately before publishing.
- The root package is `private: true`; its `bin` points to
  `scripts/screenbranch.mjs`.
- The executable invokes pnpm workspace filters and `tsx` source entry points.
- `npm pack --dry-run --json` produced 141 files, about 1.1 MB unpacked, including
  tests, fixtures, documentation sources, workflows, and application source.
- The local machine was not authenticated to npm at the time of research.

## How releases work now

| Layer | Choice for Screenwalk | Why |
| --- | --- | --- |
| Public registry | npm | It is the shared package registry used by npm, pnpm, and other JS package managers. |
| Repository package manager | pnpm | Already used by the monorepo; this does not determine the publication registry. |
| User command | `npx screenwalk` | Lowest-friction copy-and-run path; also document `pnpm dlx screenwalk`. |
| Package shape | One built CLI package | Keep internal schema, scanner, capture, Studio, fixtures, and docs packages private unless a public API is intentionally designed. |
| First release | Manual, with 2FA | A brand-new package must exist before npm staged publishing can be configured. |
| Later authentication | npm Trusted Publishing via GitHub Actions OIDC | Avoids a long-lived write token and automatically adds provenance for eligible public packages. |
| Approval | npm staged publishing | CI stages an artifact; a maintainer reviews and approves it with 2FA. |
| Version/change review | Changesets release PR | Fits the pnpm monorepo and makes version and changelog changes reviewable. Use one release system, not Changesets and release-please together. |
| PR install previews | pkg.pr.new, optional | Lets reviewers execute a package preview without publishing it to npm. |
| Public signals | npm version, provenance, CI, and downloads | Downloads are distribution telemetry, not proof of active users or product value. |

## Release gate

1. Add a dedicated publishable CLI package while keeping the root and internal
   workspace packages private.
2. Produce a built ESM entry with a Node shebang and no runtime dependency on
   pnpm, `tsx`, or workspace resolution.
3. Use an explicit `files` allowlist and complete metadata: `bin`, `engines`,
   `repository`, `license`, and public publish configuration.
4. Run `npm pack`, inspect every packed file, then install the tarball in a clean
   temporary project outside the repository.
5. Prove `--help`, scanning, capture, local Studio startup, and prompt export from
   that clean installation.
6. Publish the first 0.x release with 2FA. Configure OIDC trusted publishing and
   staged approval immediately afterward.
7. Add version and weekly-download badges only after the registry package exists.

The first version can be `0.1.0` on the default `latest` tag for a simple public
beta, or `0.1.0-beta.1` on a `beta` tag if accidental adoption should be gated.
For the small friend beta, `0.1.0` is the clearer default once the clean-install
gate passes.

## Research method and evidence quality

Exa and Parallel were queried with comparable objectives covering TypeScript CLI
release practice, npm OIDC/provenance, staged publishing, Changesets,
release-please, preview packages, and download metrics. Both surfaced npm Trusted
Publishing, Changesets, and pkg.pr.new. Exa emphasized npm's newer OIDC and staged
publishing documentation; Parallel supplied broader release-tool examples. Their
material conclusions agreed.

Apify inspected current GitHub surfaces for real open-source release usage. It
confirmed active Changesets workflows and npm trusted-publisher migration work,
but this is contextual adoption evidence rather than proof that those tools fit
Screenwalk. The repo shape and primary documentation determine the recommendation.

An OpenRouter critique used current GLM 5.3, Kimi K3, and MiniMax M3 endpoints.
GLM and Kimi independently identified the non-self-contained CLI and oversized
tarball as hard blockers. MiniMax returned no usable critique, so it was recorded
as a provider/model failure rather than treated as agreement. Model opinions were
not used as factual sources.

## Query and evidence log

1. Broad: current TypeScript CLI npm release practices. This identified OIDC,
   provenance, release PRs, and preview packages.
2. Narrow: official npm trusted and staged publishing rules. This established
   runtime requirements and the initial-package limitation.
3. Narrow: Changesets versus release-please. Both make releases reviewable;
   Changesets better matches this pnpm monorepo and should not be combined with a
   second version authority.
4. Validation: local `npm pack --dry-run` and executable inspection. This
   falsified the hypothesis that Screenwalk could be published unchanged.
5. Signal check: npm downloads endpoint and Shields output. This confirmed that a
   public count can be displayed while leaving its interpretation bounded.

## Risks and non-goals

- A download badge can count CI, mirrors, repeat installs, and other non-user
  activity. Never describe it as active usage.
- Playwright/browser installation and supported Node versions must be tested and
  documented from the packed artifact, not inferred from the monorepo.
- Do not expose internal workspace packages merely to make bundling easier.
- Do not add Figma, annotation, hosted collaboration, or automatic-fix promises
  to justify the package launch.

## Primary sources

Accessed 2026-08-25:

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers/
- npm staged publishing: https://docs.npmjs.com/staged-publishing/
- Changesets introduction: https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md
- Changesets GitHub Action: https://github.com/changesets/action
- release-please design: https://github.com/googleapis/release-please/blob/main/docs/design.md
- pkg.pr.new: https://github.com/stackblitz-labs/pkg.pr.new
- npm downloads API used for validation: https://api.npmjs.org/downloads/point/last-week/typescript
- Shields npm download endpoint used for validation: https://img.shields.io/npm/dw/typescript.json

## Next step

Create a focused packaging PR whose acceptance test installs the generated
tarball into a clean directory and runs the real Screenwalk workflow. Publishing
is a separate, explicit release action after that PR passes.
