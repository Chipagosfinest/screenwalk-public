# Framework cookbook

Screenwalk's browser capture is framework-agnostic. Its source analysis is not.

If a real browser can reach your running app and its navigation appears as same-origin links or History API routes, Screenwalk can attempt to discover and capture that UI. Today, only Next.js App Router projects receive deep filesystem-route and static-navigation inventory before the browser runs.

## Support at a glance

| Project shape | Actual-UI capture | Deep source inventory | Start URL |
| --- | --- | --- | --- |
| Next.js App Router | Yes | Yes | Usually `http://127.0.0.1:3000` |
| Next.js Pages Router | Yes | No | Usually `http://127.0.0.1:3000` |
| Vite: React, Vue, Preact, Solid | Yes | No | Usually `http://127.0.0.1:5173` |
| SvelteKit | Yes | No | Usually `http://127.0.0.1:5173` |
| Astro | Yes | No | Usually `http://127.0.0.1:4321` |
| Nuxt | Yes | No | Use the URL printed by Nuxt |
| React Router framework mode / Remix | Yes | No | Use the URL printed by the app |
| Angular and other browser apps | Browser-first beta | No | Use the URL printed by the app |
| Plain multi-page HTML | Yes | Browser-observed links only | Your static server URL |

Default ports are hints. The URL printed by your running application is authoritative—development servers often choose another port when the default is occupied.

## The two-terminal pattern

Every framework uses the same boundary:

```bash
# Terminal 1 · the target project
pnpm dev

# Terminal 2 · the Screenwalk checkout
npx screenwalk /absolute/path/to/project \
  --url http://127.0.0.1:PORT
```

Keep both processes running. Screenwalk connects to the app you started; it never starts, stops, or replaces that dev server.

## Next.js App Router

```bash
# Target project
pnpm dev

# Screenwalk checkout
npx screenwalk /absolute/path/to/next-app \
  --url http://127.0.0.1:3000
```

Screenwalk inventories `page`, `loading`, `error`, and `not-found` files plus static navigation candidates, then reconciles them with browser evidence. Dynamic patterns such as `/products/[id]` still need a concrete link or setup route before they can be rendered.

The Pages Router can still use browser discovery, but it does not receive App Router source inventory in the current beta.

## Vite apps

This applies to React, Vue, Preact, Solid, and other Vite-powered browser apps.

```bash
# Target project
pnpm dev

# Screenwalk checkout
npx screenwalk /absolute/path/to/vite-app \
  --url http://127.0.0.1:5173
```

Screenwalk follows rendered anchors and observes History API destinations. Route declarations that never render a safe link remain unknown unless a concrete URL is supplied through the running experience.

## SvelteKit

```bash
# Target project
pnpm dev

# Screenwalk checkout
npx screenwalk /absolute/path/to/sveltekit-app \
  --url http://127.0.0.1:5173
```

SvelteKit file routes are not statically inventoried yet. Captured routes and transitions are browser evidence only.

## Astro

```bash
# Target project
pnpm dev

# Screenwalk checkout
npx screenwalk /absolute/path/to/astro-site \
  --url http://127.0.0.1:4321
```

Server-rendered pages and hydrated islands are both visible to the browser. Client behavior that requires a button, form, or other non-anchor action is not automatically performed.

## Nuxt

```bash
# Target project
pnpm dev

# Screenwalk checkout — use the exact URL Nuxt printed
npx screenwalk /absolute/path/to/nuxt-app \
  --url http://127.0.0.1:3000
```

`<NuxtLink>` normally renders an anchor that browser discovery can observe. File routes and route middleware are not statically inventoried in this beta.

## React Router framework mode and Remix

```bash
# Target project
pnpm dev

# Screenwalk checkout — use the exact URL from the target server
npx screenwalk /absolute/path/to/react-router-app \
  --url http://127.0.0.1:5173
```

React Router applications can own their server and port, so never assume the example URL is correct. Browser discovery can follow rendered links and client navigation; route configuration is not a deep source adapter today.

## Plain HTML

Any local static server works. For a directory of HTML files:

```bash
# Target directory
python3 -m http.server 8080

# Screenwalk checkout
npx screenwalk /absolute/path/to/html-site \
  --url http://127.0.0.1:8080
```

Screenwalk follows visible same-origin links across HTML documents. It does not require a package manifest or framework.

## Monorepos

Pass the path to the frontend application, not automatically the monorepo root, unless the route files live at the root:

```bash
npx screenwalk /absolute/path/to/monorepo/apps/web \
  --url http://127.0.0.1:3000
```

## When browser discovery is not enough

Use [password-gated capture](/guide/access-gates) to establish an allowed access view. Raise `--discover-depth` only when another safe link hop is required. A route reachable only through form submission, a consequential action, CAPTCHA, MFA, or OAuth consent remains outside automatic discovery.

See [supported apps and limits](/reference/support) for the exact evidence boundary.
