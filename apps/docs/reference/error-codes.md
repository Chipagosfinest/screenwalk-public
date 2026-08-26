# Error codes

Screenwalk prefixes actionable terminal failures so people and coding agents can search for the exact recovery path.

## `SB_TARGET_UNREACHABLE`

Screenwalk could not connect to the supplied `--url`.

Check that the target dev server is still running, copy its exact printed URL, and run Doctor before retrying:

```bash
npx screenwalk doctor /absolute/path/to/app \
  --url http://127.0.0.1:3000
```

Hostnames, ports, and HTTP/HTTPS can affect cookies, authentication allowlists, and reachability.

## `SB_SETUP_INVALID`

The access setup file could not be read or does not match `screenbranch.setup.v0`.

Validate that the file is JSON and includes `schemaVersion`, `persona`, `label`, `startRoute`, and `actions`. See the [setup recipe reference](/reference/setup-recipes).

## `SB_SETUP_ENV_MISSING`

A setup recipe names one or more environment variables that are not present in the Screenwalk command environment.

Set the named variable and rerun the same command. Never replace `valueFromEnv` with a literal password or token in the JSON file.

## `SB_CAPTURE_*`

A viewport/access-view capture did not finish. The suffix identifies the failing capture, for example a desktop public context or mobile preview context.

Read the browser message immediately above the code, confirm the target URL still loads, and retry with timing evidence:

```bash
npx screenwalk /absolute/path/to/app \
  --url http://127.0.0.1:3000 \
  --timing-json /tmp/screenwalk-timings.json
```

The last good graph remains the trustworthy artifact when a watch-mode recapture fails.

## Studio start failure

If capture completes but Studio does not start at its printed URL, another process may own the port or the frontend build may have failed. The captured graph remains on disk. Run `pnpm build`, inspect the first error, and retry without terminating an unrelated dev server.

## Report an unknown code

Copy the complete code, the sanitized command, and the closest preceding terminal message into the [public-beta issue form](https://github.com/Chipagosfinest/screenwalk-public/issues/new?template=public-beta-feedback.yml). Do not include credentials, customer data, or unredacted sensitive captures.
