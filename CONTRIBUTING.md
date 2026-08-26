# Contributing to Screenwalk

Screenwalk is in public beta. The most useful contributions make the local capture → critique → change brief → rerun loop more trustworthy on a real app.

## Before opening a change

1. Search existing issues and open one focused issue when the behavior is not already tracked.
2. Remove secrets, customer data, private URLs, deployment identifiers, and unredacted product captures from reproductions.
3. Keep one concern per pull request. Preserve evidence labels rather than converting unknown behavior into a confident claim.

## Local verification

Use Node.js 22 and pnpm 11.18.0, then run:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify:clean
```

For UI changes, run the HTML fixture, complete the selected-screen feedback loop, and include the exact path and viewport you checked. Do not add private dogfood captures or named production evidence to the public repository.

By contributing, you agree that your contribution is licensed under the MIT License.
