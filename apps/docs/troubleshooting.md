# Troubleshooting

Start with Doctor. It catches the common environment and connection problems before capture:

```bash
pnpm screenwalk doctor /absolute/path/to/app \
  --url http://127.0.0.1:3000
```

Add `--json` when handing the result to an agent.

## Screenwalk cannot reach the app

Confirm the target app is still running and use the exact URL printed by its dev server. `localhost`, `127.0.0.1`, ports, and HTTP/HTTPS are not interchangeable in every auth or cookie setup.

Screenwalk never starts or replaces the target dev server.

If the target uses a non-Next framework, copy its printed URL rather than assuming its default port. See the [framework cookbook](/guide/frameworks).

## Browser executable is unavailable

The capture package falls back to the installed Chrome channel and reports that choice. If Doctor still fails, install the repository dependencies again and check that a supported Chromium browser is available.

## A dynamic route is code-only

A pattern such as `/items/[id]` is not a renderable URL. Reach a concrete item URL from a captured screen or add a bounded setup path that lands on one.

## The map is noisy or slow

Keep the default discovery depth of one. Raise `--discover-depth` or `--max-screens` only for a deliberate deeper audit. Use `--timing-json /tmp/screenwalk-timings.json` to identify slow routes and phases.

## Local auth or CSP errors appear

Open **Review findings** and copy the runtime evidence. Localhost may be missing from an auth provider's allowlist, cookies may be scoped to another host, or CSP may block a capture asset. These are observations during the route capture, not automatic proof of root cause.

## `SB_SETUP_ENV_MISSING`

Set the named variable in the command environment. The setup JSON should contain `valueFromEnv`, never the credential value itself.

## A screen looks stale

Run with `--watch`. A failed recapture preserves the last good graph and prints the refresh failure; it does not silently replace working evidence.

## A graph does not open

Validate the artifact directly:

```bash
pnpm screenwalk validate /absolute/path/to/graph.json
```

## The map looks wrong

Preserve the smallest sanitized reproduction: framework, command without secrets, affected route, expected path, actual evidence label, and any copied finding. See [public beta feedback](/beta).

## Look up a terminal code

Use the [error-code reference](/reference/error-codes) for `SB_TARGET_UNREACHABLE`, setup failures, and viewport/access-view capture failures.

Still blocked? Open the [public-beta issue form](https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml). Do not attach secrets, customer data, or unredacted sensitive captures.
