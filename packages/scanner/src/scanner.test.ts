import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanNextApp, scanRepository, titleFromSource } from "./scanner.ts";
import { inspectRepository, selectService } from "./topology.ts";

test("uses a named dynamic page component instead of exposing its parameter name", () => {
  assert.equal(titleFromSource("/s/[id]", "export default async function SearchPage() {}"), "Search");
  assert.equal(titleFromSource("/products/[productId]", "export default function ProductDetailView() {}"), "Product Detail");
  assert.equal(titleFromSource("/settings", "export default function AccountPage() {}"), "Settings");
});

test("maps fixture pages, branches, journeys, and unresolved targets", async () => {
  const graph = await scanNextApp(resolve("../../fixtures/next-app"));

  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.edges.length, 6);
  assert.equal(graph.journeys.length, 3);
  assert.equal(graph.gaps.length, 4);
  assert.ok(graph.edges.every((edge) => edge.evidence[0]?.kind === "static"));
  assert.ok(graph.nodes.some((node) => node.route === "/onboarding/profile"));
  assert.deepEqual(
    graph.nodes.filter((node) => node.stateKey !== "default").map((node) => node.stateKey).sort(),
    ["error", "loading", "not-found"],
  );
  assert.ok(graph.nodes.every((node) => node.identity?.familyId && node.identity.variantId));
  assert.equal(graph.nodes.find((node) => node.route === "/dashboard")?.identity?.routeTemplate, "/dashboard");
  assert.equal(graph.gaps.filter((gap) => gap.kind === "unobserved-state").length, 3);
  assert.ok(graph.journeys.every((journey) => !/^Journey \d+$/.test(journey.title)));
});

test("detects monorepo services, deploy providers, integrations, and environments without reading secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-topology-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture-mono", private: true }), "utf8");
    for (const service of ["web", "auth", "worker"]) await mkdir(join(root, "apps", service), { recursive: true });
    await writeFile(join(root, "apps/web/package.json"), JSON.stringify({ name: "@fixture/web", scripts: { dev: "next dev" }, dependencies: { next: "1", "@launchdarkly/node-server-sdk": "1" } }), "utf8");
    await writeFile(join(root, "apps/web/railway.json"), "{}", "utf8");
    await writeFile(join(root, "apps/web/.env.example"), "NEXT_PUBLIC_AUTH_SERVER_URL=https://auth.example.test\nNEXT_PUBLIC_SENTRY_DSN=\n", "utf8");
    await writeFile(join(root, "apps/web/README.md"), "Production: https://app.fixture.test\nStaging: https://web-code-preview.up.railway.app\n", "utf8");
    await mkdir(join(root, "apps/web/app"));
    await writeFile(join(root, "apps/web/app/page.tsx"), "import { createClient } from '@supabase/supabase-js'; import { Browserbase } from '@browserbasehq/sdk'; import { Resend } from 'resend'; export default function HomePage() { return null }", "utf8");
    await writeFile(join(root, "apps/auth/package.json"), JSON.stringify({ name: "@fixture/auth", scripts: { start: "node server.js" }, dependencies: { hono: "1" } }), "utf8");
    await writeFile(join(root, "apps/auth/Dockerfile"), "FROM node:22", "utf8");
    await writeFile(join(root, "apps/worker/package.json"), JSON.stringify({ name: "@fixture/worker", scripts: { start: "node worker.js" } }), "utf8");

    const topology = await inspectRepository(root);
    assert.equal(topology.repository.kind, "monorepo");
    assert.deepEqual(topology.services.map((service) => service.id), ["apps-auth", "apps-web", "apps-worker"]);
    const web = topology.services.find((service) => service.id === "apps-web");
    assert.deepEqual(web?.deployProviders, ["railway"]);
    assert.ok(web?.integrations.some((integration) => integration.name === "Sentry" && integration.via === "NEXT_PUBLIC_SENTRY_DSN"));
    assert.ok(web?.integrations.some((integration) => integration.name === "Supabase" && integration.evidence === "source-reference" && integration.sourceFile === "apps/web/app/page.tsx"));
    assert.ok(web?.integrations.some((integration) => integration.name === "Browserbase" && integration.evidence === "source-reference"));
    assert.ok(web?.integrations.some((integration) => integration.name === "Resend" && integration.evidence === "source-reference"));
    assert.ok(web?.featureFlags.some((flag) => flag.provider === "LaunchDarkly" && flag.evidence === "dependency"));
    assert.ok(web?.environments.some((item) => item.environment === "production" && item.url === "https://app.fixture.test"));
    assert.ok(web?.environments.some((item) => item.environment === "staging"));

    const graph = await scanRepository(root, "apps-web");
    assert.equal(graph.project.service?.id, "apps-web");
    assert.equal(graph.nodes[0]?.sourceFile, "apps/web/app/page.tsx");
    assert.equal(selectService(topology)?.id, "apps-web");
    assert.equal((await scanRepository(root)).project.service?.id, "apps-web");
    await assert.rejects(() => scanRepository(root, "missing"), /Unknown service missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not classify an unlabeled canonical Vercel domain as preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-vercel-environment-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "web", scripts: { dev: "next dev" }, dependencies: { next: "1" } }), "utf8");
    await writeFile(join(root, ".env.example"), "NEXT_PUBLIC_APP_URL=https://app-canonical.vercel.app\n", "utf8");
    const topology = await inspectRepository(root);
    assert.equal(topology.services[0]?.environments[0]?.environment, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps a plain HTML application eligible for browser discovery", async () => {
  const fixture = resolve("../../fixtures/html-app");
  const topology = await inspectRepository(fixture);
  assert.equal(topology.services[0]?.kind, "web");
  assert.equal(topology.services[0]?.framework, "html");

  const graph = await scanRepository(fixture);
  assert.equal(graph.project.framework, "web");
  assert.equal(graph.project.service?.id, "app");
  assert.equal(graph.nodes[0]?.route, "/");
});

test("treats a static HTML and API hybrid as a browser surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-hybrid-"));
  try {
    await mkdir(join(root, "public"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "hybrid-app",
      scripts: { start: "node server.js" },
      dependencies: { hono: "1" },
    }), "utf8");
    await writeFile(join(root, "public", "index.html"), "<h1>Hybrid</h1>", "utf8");

    const topology = await inspectRepository(root);
    assert.equal(topology.services[0]?.framework, "html");
    assert.equal(topology.services[0]?.kind, "web");
    assert.equal((await scanRepository(root)).nodes[0]?.sourceFile, "public/index.html");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects a server-rendered HTML entry point without a static index", async () => {
  const fixture = resolve("../../fixtures/gated-app");
  const topology = await inspectRepository(fixture);
  assert.equal(topology.services[0]?.framework, "html-server");
  assert.equal(topology.services[0]?.kind, "web");
  assert.equal((await scanRepository(fixture)).nodes[0]?.sourceFile, "server.mjs");
});

test("keeps a runnable root app when the monorepo also contains libraries", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-root-app-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "root-web", private: true, scripts: { dev: "turbo run dev" }, dependencies: { next: "1" } }), "utf8");
    await mkdir(join(root, "app"));
    await writeFile(join(root, "app/page.tsx"), "export default function HomePage() { return null }", "utf8");
    await mkdir(join(root, "packages/ui"), { recursive: true });
    await writeFile(join(root, "packages/ui/package.json"), JSON.stringify({ name: "@fixture/ui" }), "utf8");

    const topology = await inspectRepository(root);
    assert.equal(topology.repository.kind, "monorepo");
    assert.deepEqual(topology.services.map((service) => service.id), ["app"]);
    assert.equal((await scanRepository(root)).nodes[0]?.route, "/");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves a non-Next browser service and its topology for runtime discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-astro-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "astro-web", scripts: { dev: "astro dev" }, dependencies: { astro: "1" } }), "utf8");
    const graph = await scanRepository(root);
    assert.equal(graph.project.service?.framework, "astro");
    assert.equal(graph.nodes[0]?.sourceFile, "(browser discovery)");
    assert.equal(graph.nodes[0]?.evidence[0]?.kind, "declared");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not let an unrelated public index hide a Next.js source tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "screenwalk-next-public-index-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "next-web", scripts: { dev: "next dev" }, dependencies: { next: "1" } }), "utf8");
    await mkdir(join(root, "app"));
    await mkdir(join(root, "public"));
    await writeFile(join(root, "app/page.tsx"), "export default function HomePage() { return null }", "utf8");
    await writeFile(join(root, "public/index.html"), "<h1>Static asset</h1>", "utf8");
    const graph = await scanRepository(root);
    assert.equal(graph.project.service?.framework, "next");
    assert.equal(graph.nodes[0]?.sourceFile, "app/page.tsx");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
