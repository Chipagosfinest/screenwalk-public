# Supported apps and current limits

Screenwalk's capture boundary is broader than its source-analysis boundary.

| Application shape | Runtime capture | Source inventory | Current status |
| --- | --- | --- | --- |
| Next.js App Router | Desktop and mobile | Filesystem routes and static candidates | First-class |
| Next.js Pages Router | Desktop and mobile | Browser-observed links | Browser-first beta |
| Plain multi-page HTML | Desktop and mobile | Browser-observed links | Certified fixture |
| Client-routed Vite SPA | Desktop and mobile | Browser-observed History API paths | Certified fixture |
| Astro, Nuxt, SvelteKit, React Router, Angular | Browser-first when reachable | No deep source adapter | Beta; verify evidence |
| Password-gated HTML | Public plus recipe-established access view | Browser-observed links | Certified fixture |
| Other local web apps | Browser-first when reachable | Adapter-dependent | Beta; verify evidence |
| Native mobile apps | No | No | Deferred |

## Current limits

- The application must already be running at a reachable local or preview URL.
- Automatic discovery follows visible same-origin anchors, not arbitrary application actions.
- Dynamic source routes need a concrete observed URL or explicit recipe before they can be captured.
- Concrete URLs that match one dynamic source route, such as `/products/[id]`, share one screen identity. Screenwalk keeps a representative browser capture and route-family evidence instead of turning changing records or search results into separate screens.
- CAPTCHA, MFA, OAuth consent, and arbitrary scripts require human handoff.
- Source-level extraction beyond Next.js is limited even when browser capture succeeds.
- Watch mode captures snapshots; it is not a continuous live mirror.
- A route or state absent from current evidence is not proof that it does not exist.

The public beta prioritizes honest coverage over unsupported framework claims. If a map looks complete but wrong, treat that as a bug and include sanitized evidence in the beta report.

Use the [framework cookbook](/guide/frameworks) for stack-specific startup recipes. A recipe means the runtime boundary is supported; it does not upgrade that framework to deep source analysis.
