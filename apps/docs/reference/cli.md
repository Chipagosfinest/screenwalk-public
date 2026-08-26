# CLI reference

## Commands

```text
npx screenwalk <running-app-url> [options]
npx screenwalk <project> --url <running-app-url> [options]
npx screenwalk inspect <project> [--out <topology.json>]
npx screenwalk doctor <project> --url <running-app-url> [--json]
npx screenwalk validate <graph.json>
```

### `screenwalk`

Scans a repository, captures its running UI, writes a versioned graph, starts Studio, and opens the map. When the URL is the positional argument, Screenwalk uses the current directory as the project.

### `doctor`

Checks project path, URL connectivity, browser availability, output paths, and the optional setup recipe. Add `--json` for an agent or script.

### `inspect`

Inventories runnable services, deployment configuration, documented environment URLs, integrations, and feature-flag providers without opening a browser or reading deployed secret values. Signals are labeled as configuration, dependency, or bounded source reference. They do not prove that an integration or flag is active, expose flag values, or enumerate targeting rules. Repositories with more than one browser surface require an explicit `--service` during capture.

### `validate`

Validates a graph against the current versioned contract without starting capture or Studio.

## Options

| Option | Purpose |
| --- | --- |
| `--url <url>` | Running target application. Required for Doctor and when a project path is positional. |
| `--service <id>` | Runnable service to scan in a monorepo. Required when multiple browser surfaces are found. |
| `--environment <name>` | Explicit target identity such as `local`, `preview`, `staging`, or `production`. Otherwise Screenwalk records a URL-based inference. |
| `--deployment-id <id>` | Attach the exact deployment identifier to the completed capture when the platform exposes one. |
| `--out <path>` | Write Inspect topology JSON to a specific path. Inspect only. |
| `--output <path>` | Write the current captured graph to a specific path. |
| `--assets-dir <path>` | Write captured images to a specific directory. |
| `--json` | Print machine-readable Doctor results. Doctor only. |
| `--viewports <list>` | `desktop,mobile` (default), `desktop`, or `mobile`. |
| `--setup <file>` | Capture another access view with an environment-backed setup recipe. |
| `--identity-policy <file>` | Override meaningful query/hash state rules. Screenwalk automatically loads `screenwalk.identity.json` from the target project when present. |
| `--max-screens <number>` | Maximum screens discovered by the browser. Default: `30`. |
| `--discover-depth <n>` | Safe same-origin link depth. Default: `1`. |
| `--timing-json <path>` | Write route-level capture timing evidence. |
| `--watch` | Recapture affected known routes after source changes. |
| `--no-open` | Do not open the Studio browser tab. |
| `--no-studio` | Capture without starting Studio. |
| `--help`, `-h` | Print CLI help. |

The target app must already be running. Screenwalk never replaces its dev server.

## Screen identity policy

Screenwalk recognizes common state selectors such as `tab`, `view`, `mode`, `step`, `panel`, `drawer`, and `modal`. Tracking parameters, search/content queries, sorting/filtering, cursors, session-shaped values, and cache noise do not create screens. Unknown parameters are ignored and surfaced as a review suggestion instead of silently exploding the map.

Add `screenwalk.identity.json` to the target project only when its product vocabulary needs an override:

```json
{
  "schemaVersion": "screenwalk.identity.v0",
  "query": {
    "include": ["preview", "experience"],
    "ignore": ["sort"]
  },
  "hash": {
    "include": ["pane"],
    "treatPathAsRoute": true
  }
}
```

Included values become meaningful variants beneath a screen family. Ignored values remain capture evidence but do not create graph nodes.

## Exit failures

Failures include a stable error code and a suggested next action when one is available. Run `doctor` first when the browser, URL, or setup contract is unclear.
