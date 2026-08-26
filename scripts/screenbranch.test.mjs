import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isUiSourceFile } from "./source-watch.mjs";
import { inferEnvironment } from "./environment.mjs";

const root = resolve(import.meta.dirname, "..");
const cli = resolve(root, "scripts/screenbranch.mjs");
const compareCli = resolve(root, "scripts/compare-graphs.mjs");

test("help explains environment-backed access setup", () => {
  const result = spawnSync(process.execPath, [cli, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Screenwalk /);
  assert.match(result.stdout, /pnpm screenwalk/);
  assert.match(result.stdout, /<running-app-url>/);
  assert.doesNotMatch(result.stdout, /Screenbranch|pnpm screenbranch/);
  assert.match(result.stdout, /--setup <file>/);
  assert.match(result.stdout, /additional access view/);
  assert.match(result.stdout, /--identity-policy <file>/);
  assert.match(result.stdout, /--service <id>/);
  assert.match(result.stdout, /--environment <name>/);
  assert.doesNotMatch(result.stdout, /Play first path/);
});

test("inspect returns a repository topology without requiring a running app", () => {
  const result = spawnSync(process.execPath, [cli, "inspect", resolve(root, "fixtures/next-app")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const topology = JSON.parse(result.stdout);
  assert.equal(topology.schemaVersion, "screenwalk.topology.v0");
  assert.equal(topology.repository.kind, "single-app");
  assert.equal(topology.services.length, 1);
});

test("inspect resolves relative project and output paths from the caller", async () => {
  const directory = await mkdtemp(join(tmpdir(), "screenwalk-inspect-cwd-"));
  try {
    const output = join(directory, "topology.json");
    const inspectResult = spawnSync(process.execPath, [cli, "inspect", resolve(root, "fixtures/next-app"), "--out", "topology.json"], { cwd: directory, encoding: "utf8" });
    assert.equal(inspectResult.status, 0, inspectResult.stderr);
    assert.equal(JSON.parse(await readFile(output, "utf8")).schemaVersion, "screenwalk.topology.v0");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("environment inference stays neutral for ambiguous Vercel domains", () => {
  assert.equal(inferEnvironment("http://127.0.0.1:3000"), "local");
  assert.equal(inferEnvironment("https://web-code-preview.up.railway.app"), "staging");
  assert.equal(inferEnvironment("https://app-canonical.vercel.app"), "unknown");
  assert.equal(inferEnvironment("https://app.example.com"), "production");
});

test("a URL positional uses the current directory as the project", () => {
  const project = resolve(root, "fixtures/html-app");
  const result = spawnSync(process.execPath, [cli, "http://127.0.0.1:9", "--no-studio"], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`Project  ${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(result.stdout, /App      http:\/\/127\.0\.0\.1:9/);
  assert.match(result.stderr, /SB_TARGET_UNREACHABLE/);
});

test("validate returns machine-readable graph facts", () => {
  const result = spawnSync(process.execPath, [cli, "validate", resolve(root, "apps/studio/src/data/demo-graph.json")], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, schemaVersion: "screenbranch.graph.v0", nodes: 4, edges: 2, journeys: 2, gaps: 0 });
});

test("doctor JSON reports an unreachable target with a failing exit code", () => {
  const result = spawnSync(process.execPath, [cli, "doctor", resolve(root, "fixtures/next-app"), "--url", "http://127.0.0.1:9", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.id === "target")?.ok, false);
});

test("doctor explains an invalid identity policy before capture", async () => {
  const directory = await mkdtemp(join(tmpdir(), "screenwalk-identity-policy-test-"));
  try {
    const policy = join(directory, "screenwalk.identity.json");
    await writeFile(policy, JSON.stringify({ schemaVersion: "screenwalk.identity.v9", query: { include: "tab" } }), "utf8");
    const result = spawnSync(process.execPath, [cli, "doctor", directory, "--url", "http://127.0.0.1:9", "--identity-policy", policy, "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.id === "identity")?.ok, false);
    assert.match(report.checks.find((check) => check.id === "identity")?.detail ?? "", /SB_IDENTITY_POLICY_INVALID/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("watch mode treats HTML and common client framework files as UI sources", () => {
  for (const path of ["index.html", "public/about.htm", "src/App.vue", "src/routes/page.svelte", "src/pages/home.astro", "src/main.ts", "src/app.tsx", "styles/site.css"]) {
    assert.equal(isUiSourceFile(path), true, `${path} should trigger a refresh`);
  }
  for (const path of ["README.md", "public/logo.png", "node_modules/pkg/index.html", "dist/index.html", ".git/index"]) {
    assert.equal(isUiSourceFile(path), false, `${path} should be ignored`);
  }
});

test("source comparison preserves declared immutable revision identity without claiming runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "screenwalk-compare-test-"));
  try {
    const referencePath = join(directory, "reference.json");
    const candidatePath = join(directory, "candidate.json");
    const outputPath = join(directory, "comparison.json");
    const graph = (routes, edges = []) => ({
      nodes: routes.map((route, index) => ({ id: `node-${index}`, route, stateKey: "default", persona: "default", title: route, sourceFile: `app${route}/page.tsx` })),
      edges,
    });
    await Promise.all([
      writeFile(referencePath, JSON.stringify(graph(["/", "/legacy"])), "utf8"),
      writeFile(candidatePath, JSON.stringify(graph(["/", "/new"])), "utf8"),
    ]);
    const result = spawnSync(process.execPath, [compareCli,
      "--project", "Fixture",
      "--reference-label", "main", "--reference-environment", "production", "--reference-sha", "1111111", "--reference-branch", "main",
      "--candidate-label", "staging", "--candidate-environment", "staging", "--candidate-sha", "2222222", "--candidate-branch", "staging",
      "--surface", `web::Web::${referencePath}::${candidatePath}`,
      "--out", outputPath,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const comparison = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(comparison.reference.git.sha, "1111111");
    assert.equal(comparison.candidate.git.sha, "2222222");
    assert.equal(comparison.reference.evidence, "source");
    assert.equal(comparison.reference.deployment, undefined);
    assert.deepEqual(comparison.surfaces[0].sharedRoutes, ["/"]);
    assert.deepEqual(comparison.surfaces[0].changes.map(({ route, status }) => ({ route, status })), [
      { route: "/legacy", status: "only-reference" },
      { route: "/new", status: "only-candidate" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment arguments cannot promote source-only graphs to runtime evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "screenwalk-compare-source-proof-"));
  try {
    const graphPath = join(directory, "graph.json");
    await writeFile(graphPath, JSON.stringify({ nodes: [{ id: "home", route: "/", stateKey: "default", persona: "default" }], edges: [] }), "utf8");
    const result = spawnSync(process.execPath, [compareCli,
      "--project", "Fixture", "--reference-label", "main", "--candidate-label", "staging",
      "--reference-url", "https://prod.example.test", "--candidate-url", "https://staging.example.test",
      "--surface", `web::Web::${graphPath}::${graphPath}`, "--out", join(directory, "comparison.json"),
    ], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deployment arguments cannot upgrade source evidence/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime comparison derives identity from complete captured graphs and validates expectations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "screenwalk-compare-runtime-"));
  try {
    const referencePath = join(directory, "reference.json");
    const candidatePath = join(directory, "candidate.json");
    const outputPath = join(directory, "comparison.json");
    const graph = (sha, branch, environment, url, deploymentId) => ({
      nodes: [{ id: "home", route: "/", stateKey: "default", persona: "default", captureVariants: { desktop: { quality: "ready" } } }],
      edges: [],
      run: { status: "complete", completedAt: "2026-08-25T00:00:00.000Z", baseUrl: url, environment, revision: { sha, branch, dirty: false }, deployment: { id: deploymentId, url } },
    });
    await Promise.all([
      writeFile(referencePath, JSON.stringify(graph("1111111", "main", "production", "https://prod.example.test", "prod-1")), "utf8"),
      writeFile(candidatePath, JSON.stringify(graph("2222222", "staging", "staging", "https://stage.example.test", "stage-1")), "utf8"),
    ]);
    const command = [compareCli,
      "--project", "Fixture", "--reference-label", "main", "--candidate-label", "staging",
      "--reference-url", "https://prod.example.test", "--candidate-url", "https://stage.example.test",
      "--surface", `web::Web::${referencePath}::${candidatePath}`, "--out", outputPath,
    ];
    const result = spawnSync(process.execPath, command, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const comparison = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(comparison.reference.evidence, "runtime");
    assert.equal(comparison.reference.git.sha, "1111111");
    assert.equal(comparison.reference.deployment.id, "prod-1");
    assert.equal(comparison.reference.capturedAt, "2026-08-25T00:00:00.000Z");

    const mismatch = spawnSync(process.execPath, [...command.slice(0, -2), "--reference-sha", "9999999", ...command.slice(-2)], { cwd: root, encoding: "utf8" });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match graph evidence/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
