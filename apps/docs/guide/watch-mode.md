# Watch for UI changes

Use watch mode when Screenwalk is part of the local edit-and-review loop.

```bash
npx screenwalk /absolute/path/to/app \
  --url http://127.0.0.1:3000 \
  --watch
```

When source files change, Screenwalk recaptures affected known routes when possible and refreshes Studio after a successful run. If recapture fails, the last good graph stays visible and the terminal reports the failure.

## What persists

- dragged canvas positions per project;
- selected screen, flow focus, journey, viewport, and display mode in the URL;
- immutable run manifests with stable node IDs and screenshot content hashes;
- added, removed, and changed screen IDs between completed runs.

## What watch mode does not promise

Watch mode is evidence-based snapshotting, not a continuous mirror of every browser state. It does not observe UI that no known route or safe interaction exposes, and it does not replay entrance motion simply because the map refreshed.

For automated runs, add `--no-open` or `--no-studio`. Add `--timing-json /tmp/screenwalk-timings.json` when you need route-level performance evidence.
