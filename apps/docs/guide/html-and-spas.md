# HTML sites and client-routed SPAs

Screenwalk can map real rendered UI without requiring Next.js or a source adapter.

```bash
npx screenwalk /absolute/path/to/html-site \
  --url http://127.0.0.1:8080

npx screenwalk /absolute/path/to/vite-spa \
  --url http://127.0.0.1:5173
```

The browser-first path follows visible same-origin anchors through multi-page HTML and History API routing. Each rendered destination can produce a capture and an observed transition receipt.

## Discovery bounds

Defaults are intentionally conservative:

- at most 30 discovered screens;
- one same-origin link depth;
- no form submission;
- no automatic button clicks;
- no following routes whose names suggest logout, deletion, checkout, purchase, or unsubscribe.

Raise the link depth only for a deliberate deeper audit:

```bash
npx screenwalk /absolute/path/to/app \
  --url http://127.0.0.1:5173 \
  --discover-depth 2 \
  --max-screens 50
```

Source-level route extraction beyond Next.js remains limited. That affects what Screenwalk can infer from files, not whether it can capture UI the browser actually reaches.
