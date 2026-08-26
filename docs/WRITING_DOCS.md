# Writing Screenwalk documentation

Screenwalk documentation is part of the product contract. A polished explanation that overstates evidence or support is a bug.

## Where content belongs

- `README.md`: positioning, visual proof, shortest private-beta start, support boundary, release status.
- `apps/docs/guide/`: task-shaped workflows and conceptual guidance.
- `apps/docs/reference/`: mechanical commands, contracts, support levels, and error lookup.
- `apps/docs/troubleshooting.md`: symptom-first recovery.
- `docs/research/`: dated evidence and decisions; never treat research or roadmap language as shipped support.

## Writing rules

- Lead with the user outcome or recovery action.
- Keep source evidence, browser observation, capture, and inference distinct.
- Say “browser-first” when a framework has runtime capture but no source adapter.
- Never publish `npx screenwalk` or package-install instructions until the package exists.
- Use one H1 per documentation page. The home page is the only exception because its VitePress hero supplies the title.
- Prefer short paragraphs, copyable commands, expected results, and a concrete next page.
- Do not call a workflow easy, simple, complete, or safe without naming its boundary.
- Credentials appear only as environment-variable names such as `SCREENWALK_PREVIEW_PASSWORD`.

## Adding a page

1. Add the Markdown file under `apps/docs/guide/` or `apps/docs/reference/`.
2. Add it to the shallow sidebar in `apps/docs/.vitepress/config.mts`.
3. Link it from the closest existing workflow page.
4. Run the documentation gate:

```bash
pnpm docs:check
```

The gate checks navigation coverage, one-title structure, local links and assets, public CLI flag parity, unpublished-package claims, agent-doc coverage, TypeScript, and the production build.

## Framework support language

Use separate columns for:

1. **Actual-UI capture**: whether the running browser experience can be discovered and captured.
2. **Deep source inventory**: whether Screenwalk understands the framework's files and static navigation before runtime.

A startup recipe does not imply a source adapter. The URL printed by the target dev server is authoritative; documented ports are examples.

## Machine-readable outputs

`scripts/build-docs-artifacts.mjs` mirrors user-facing Markdown into the built site and generates:

- `/llms.txt`: concise documentation index;
- `/llms-full.txt`: complete current documentation;
- `/markdown/**`: raw page Markdown used by Copy Markdown and agents;
- `/robots.txt`: crawl policy, plus sitemap location only when a deployment origin exists.

Do not hand-edit those generated files. They are ignored in Git and rebuilt by `pnpm docs:dev` and `pnpm docs:build`.

## Deployment metadata

Set `SCREENWALK_DOCS_ORIGIN` only to the final HTTPS docs origin. Without it, the build deliberately omits canonical URLs, absolute social images, and the sitemap. This prevents a private-beta or preview URL from becoming canonical by accident.
