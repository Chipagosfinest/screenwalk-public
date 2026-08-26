#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { access, copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inferEnvironment } from "./environment.mjs";
import { isUiSourceFile } from "./source-watch.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const invocationCwd = process.cwd();
const packagedRuntime = process.env.SCREENWALK_PACKAGED_RUNTIME === "1";
const commandPrefix = packagedRuntime ? "npx screenwalk" : "pnpm screenwalk";
const args = process.argv.slice(2);
if (args[0] === "doctor") {
  await runDoctor(args.slice(1));
  process.exit(process.exitCode ?? 0);
}
if (args[0] === "validate") {
  const graph = resolve(args[1] ?? "screenbranch.graph.json");
  const result = runInternalCli("scanner", ["validate", graph]);
  process.exit(result.status ?? 1);
}
if (args[0] === "inspect") {
  const inspectArgs = args.slice(1);
  inspectArgs[0] = resolve(invocationCwd, inspectArgs[0] ?? ".");
  const outputIndex = inspectArgs.indexOf("--out");
  if (outputIndex >= 0 && inspectArgs[outputIndex + 1]) inspectArgs[outputIndex + 1] = resolve(invocationCwd, inspectArgs[outputIndex + 1]);
  const result = runInternalCli("scanner", ["inspect", ...inspectArgs]);
  process.exit(result.status ?? 1);
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Screenwalk — turn a running product into an actual-UI flow map

Usage:
  ${commandPrefix} <running-app-url> [options]
  ${commandPrefix} <project> --url <running-app-url> [options]
  ${commandPrefix} doctor <project> --url <running-app-url> [--json]
  ${commandPrefix} inspect <project> [--out topology.json]
  ${commandPrefix} validate <graph.json>

Example:
  ${commandPrefix} ../my-app --url http://127.0.0.1:3000

Options:
  --service <id>           Select a detected web service in a monorepo
  --environment <name>     local, preview, staging, production, or unknown
  --deployment-id <id>     Record the exact deployment identifier when available
  --viewports <list>       desktop,mobile (default), desktop, or mobile
  --setup <file>           Capture an additional access view using environment-backed setup
  --identity-policy <file> Override meaningful query/hash identity rules (auto-loads screenwalk.identity.json)
  --max-screens <number>   Maximum discovered screens (default: 30)
  --discover-depth <n>     Safe same-origin link depth (default: 1)
  --output <file>          Save the current graph to this file
  --assets-dir <dir>       Save captured images to this directory
  --timing-json <path>     Save route-level timing evidence
  --watch                  Recapture affected routes when source files change
  --no-open                Do not open the Studio browser tab
  --no-studio              Capture without starting Studio
  --help, -h               Show this help

The target app must already be running. Screenwalk never replaces its dev server.`);
  process.exit(0);
}
const positional = args.filter((value, index) => !value.startsWith("--") && (index === 0 || !args[index - 1]?.startsWith("--")));
const targetArgument = positional[0];
const targetIsUrl = typeof targetArgument === "string" && /^https?:\/\//.test(targetArgument);
const projectRoot = resolve(targetIsUrl ? "." : targetArgument ?? ".");
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const baseUrl = option("--url", targetIsUrl ? targetArgument : "http://127.0.0.1:3000");
const serviceId = option("--service");
const environment = option("--environment", inferEnvironment(baseUrl));
const environmentEvidence = args.includes("--environment") ? "declared" : "inferred";
const deploymentId = option("--deployment-id");
if (!["local", "preview", "staging", "production", "unknown"].includes(environment)) throw new Error("--environment must be local, preview, staging, production, or unknown");
const maxScreens = option("--max-screens", "30");
const discoverDepth = option("--discover-depth", "1");
const setupOption = option("--setup");
const setupPath = setupOption ? resolve(setupOption) : undefined;
const setupSummary = setupPath ? await readSetupSummary(setupPath) : undefined;
const identityPolicyOption = option("--identity-policy");
const automaticIdentityPolicy = resolve(projectRoot, "screenwalk.identity.json");
const identityPolicyPath = identityPolicyOption
  ? resolve(identityPolicyOption)
  : await exists(automaticIdentityPolicy) ? automaticIdentityPolicy : undefined;
if (identityPolicyPath) await readIdentityPolicy(identityPolicyPath);
const viewports = option("--viewports", "desktop,mobile").split(",").filter((value) => value === "desktop" || value === "mobile");
if (viewports.length === 0) throw new Error("--viewports must include desktop, mobile, or both");
const noOpen = args.includes("--no-open");
const noStudio = args.includes("--no-studio");
const defaultOutputRoot = packagedRuntime ? resolve(invocationCwd, ".screenwalk") : resolve(repositoryRoot, "apps/studio/public");
const graphPath = resolve(option("--output", resolve(defaultOutputRoot, "screenbranch.graph.json")));
const assetsDirectory = resolve(option("--assets-dir", resolve(defaultOutputRoot, "captures/current")));
const assetPrefix = option("--asset-prefix", "/captures/current");
const timingOutput = option("--timing-json");
const requestedRoutes = option("--routes", "").split(",").filter(Boolean);
const watchRequested = args.includes("--watch");
const runsDirectory = resolve(option("--runs-dir", packagedRuntime ? resolve(defaultOutputRoot, "runs") : resolve(repositoryRoot, "output/runs")));
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const runStartedIso = new Date().toISOString();
const previousGraph = await readJsonIfPresent(graphPath);
const revision = readGitRevision(projectRoot);

console.log(`\nScreenwalk · ${basename(projectRoot)}`);
console.log(`Project  ${projectRoot}`);
console.log(`App      ${baseUrl}`);
console.log(`Context  ${serviceId ?? "auto service"} · ${environment}`);
console.log(`Capture  ${viewports.join(" + ")}${setupSummary ? ` · Public + ${setupSummary.label}` : ""}\n`);

console.log("[1/4] Connecting to the running app…");
await assertReachable(baseUrl);
console.log(`      ✓ Connected to ${baseUrl}`);
await mkdir(dirname(graphPath), { recursive: true });
await mkdir(assetsDirectory, { recursive: true });

const runStartedAt = Date.now();
console.log("[2/4] Scanning routes and source links…");
const scanStartedAt = Date.now();
const scanArgs = ["scan", projectRoot, "--out", graphPath];
if (serviceId) scanArgs.push("--service", serviceId);
const scan = runInternalCli("scanner", scanArgs, "pipe");
const scanDuration = Date.now() - scanStartedAt;

if (scan.status === 0) {
  process.stdout.write(scan.stdout);
  console.log(`      ✓ Source graph ready in ${formatDuration(scanDuration)}`);
} else {
  if (/Multiple runnable services detected|not a browser UI/.test(scan.stderr)) {
    process.stderr.write(scan.stderr);
    process.exit(scan.status ?? 1);
  }
  const url = new URL(baseUrl);
  const projectName = await readProjectName(projectRoot, url.hostname);
  const seed = {
    schemaVersion: "screenbranch.graph.v0",
    project: { name: projectName, root: projectRoot, framework: "web", generatedAt: new Date().toISOString() },
    nodes: [{
      id: "screen:root",
      title: "Home",
      route: "/",
      sourceFile: "(browser discovery)",
      kind: "page",
      confidence: 1,
      persona: "default",
      diagnostics: [],
      evidence: [{ kind: "declared", detail: `Runtime entry point ${baseUrl}` }],
    }],
    edges: [],
    journeys: [],
    gaps: [],
  };
  await writeFile(graphPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  console.log(`      ○ No Next.js App Router tree found; browser discovery will build the graph (${formatDuration(scanDuration)})`);
}

if (requestedRoutes.length > 0 && previousGraph) {
  const scannedGraph = JSON.parse(await readFile(graphPath, "utf8"));
  const previousById = new Map(previousGraph.nodes.map((node) => [node.id, node]));
  scannedGraph.nodes = scannedGraph.nodes.map((node) => {
    const previous = previousById.get(node.id);
    if (!previous) return node;
    return { ...node, capture: previous.capture, captureVariants: previous.captureVariants, diagnostics: previous.diagnostics, interactiveTargets: previous.interactiveTargets };
  });
  const scannedNodeIds = new Set(scannedGraph.nodes.map((node) => node.id));
  scannedGraph.nodes.push(...previousGraph.nodes.filter((node) => !scannedNodeIds.has(node.id) && node.sourceFile === "(browser discovery)"));
  const previousEdgesById = new Map(previousGraph.edges.map((edge) => [edge.id, edge]));
  scannedGraph.edges = scannedGraph.edges.map((edge) => {
    const previous = previousEdgesById.get(edge.id);
    if (!previous?.observations?.length) return edge;
    return {
      ...edge,
      confidence: previous.confidence,
      observations: previous.observations,
      evidence: [...edge.evidence, ...previous.evidence.filter((item) => item.kind === "observed")],
    };
  });
  const scannedEdgeIds = new Set(scannedGraph.edges.map((edge) => edge.id));
  scannedGraph.edges.push(...previousGraph.edges.filter((edge) => !scannedEdgeIds.has(edge.id) && edge.observations?.length));
  const observedJourneys = previousGraph.journeys.filter((journey) => journey.kind === "observed");
  const observedJourneyIds = new Set(observedJourneys.map((journey) => journey.id));
  scannedGraph.journeys = [...observedJourneys, ...scannedGraph.journeys.filter((journey) => !observedJourneyIds.has(journey.id))];
  await writeFile(graphPath, `${JSON.stringify(scannedGraph, null, 2)}\n`, "utf8");
}

const captureDurations = [];
for (const [index, viewport] of viewports.entries()) {
  console.log(`[3/4] Capturing ${viewport} UI${index === 0 ? " and observing safe branches" : ""}…`);
  const accessViews = [
    { persona: "default", label: "Public", setup: undefined },
    ...(setupSummary ? [{ persona: setupSummary.persona, label: setupSummary.label, setup: setupPath }] : []),
  ];
  for (const accessView of accessViews) {
    const captureArgs = [
      "capture", graphPath,
      "--base-url", baseUrl,
      "--assets-dir", assetsDirectory,
      "--asset-prefix", assetPrefix,
      "--out", graphPath,
      "--viewport", viewport,
      "--max-screens", maxScreens,
      "--discover-depth", discoverDepth,
    ];
    if (index === 0 && requestedRoutes.length === 0) captureArgs.push("--discover-links", "--expand-routes");
    if (requestedRoutes.length > 0) captureArgs.push("--routes", requestedRoutes.join(","));
    if (accessView.setup) captureArgs.push("--setup", accessView.setup);
    if (identityPolicyPath) captureArgs.push("--identity-policy", identityPolicyPath);
    if (timingOutput) captureArgs.push("--timing-json", viewportTimingPath(timingOutput, viewport, accessView.persona));
    const captureStartedAt = Date.now();
    runCapture(captureArgs, `SB_CAPTURE_${viewport.toUpperCase()}_${accessView.persona.toUpperCase().replaceAll("-", "_")}`);
    const duration = Date.now() - captureStartedAt;
    captureDurations.push({ viewport: `${viewport}/${accessView.label}`, duration });
    console.log(`      ✓ ${accessView.label} ${viewport} capture ready in ${formatDuration(duration)}`);
  }
}

let graph = JSON.parse(await readFile(graphPath, "utf8"));
const diff = graphDiff(previousGraph, graph);
graph = {
  ...graph,
  run: {
    id: runId,
    startedAt: runStartedIso,
    completedAt: new Date().toISOString(),
    baseUrl,
    environment,
    environmentEvidence,
    ...(revision ? { revision } : {}),
    deployment: { ...(deploymentId ? { id: deploymentId } : {}), url: baseUrl },
    serviceId: graph.project.service?.id ?? serviceId,
    status: "complete",
    previousRunId: previousGraph?.run?.id,
  },
  diff,
};
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
const runDirectory = resolve(runsDirectory, runId);
await mkdir(runDirectory, { recursive: true });
await writeFile(resolve(runDirectory, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
await writeFile(resolve(runDirectory, "manifest.json"), `${JSON.stringify({
  schemaVersion: "screenbranch.run.v0",
  run: graph.run,
  project: graph.project,
  graph: "graph.json",
  viewports,
  summary: { nodes: graph.nodes.length, edges: graph.edges.length, journeys: graph.journeys.length, gaps: graph.gaps.length, ...diff },
}, null, 2)}\n`, "utf8");
const observedEdges = graph.edges.filter((edge) => edge.observations?.length).length;
const variants = Object.fromEntries(viewports.map((viewport) => [viewport, graph.nodes.filter((node) => node.captureVariants?.[viewport]?.quality === "ready").length]));
const accessViewCount = new Set(graph.nodes.map((node) => node.persona)).size;
console.log(`\nMap ready · ${viewports.map((viewport) => `${variants[viewport]} useful ${viewport} screens`).join(" · ")} · ${accessViewCount} access ${accessViewCount === 1 ? "view" : "views"} · ${observedEdges} observed transitions`);
console.log(`Timing    · scan ${formatDuration(scanDuration)} · ${captureDurations.map(({ viewport, duration }) => `${viewport} ${formatDuration(duration)}`).join(" · ")} · total ${formatDuration(Date.now() - runStartedAt)}`);
console.log(`Output    · ${graphPath}`);

if (!noStudio) {
  console.log("[4/4] Opening the local Studio…");
  let studioUrl;
  if (packagedRuntime) {
    studioUrl = await startPackagedStudio();
  } else {
    studioUrl = "http://127.0.0.1:5173/?graph=local";
    if (!(await reachable(studioUrl))) {
      const studio = spawn("pnpm", ["--filter", "@screenbranch/studio", "dev", "--host", "127.0.0.1"], {
        cwd: repositoryRoot,
        stdio: "inherit",
      });
      process.on("SIGINT", () => studio.kill("SIGINT"));
      await waitUntilReachable(studioUrl, 12_000);
    }
  }
  if (!noOpen && process.platform === "darwin") spawn("open", [studioUrl], { detached: true, stdio: "ignore" }).unref();
  console.log(`      ✓ Studio ready at ${studioUrl}`);
  console.log("\nStart with “All screens” to review what rendered and what still needs proof.");
  console.log("Keep this command running while Studio is open. Press Ctrl-C to stop it.");
}

if (watchRequested) startSourceWatcher();

function runInternalCli(name, commandArgs, output = "inherit") {
  if (packagedRuntime) {
    return spawnSync(process.execPath, [resolve(repositoryRoot, `dist/${name}.mjs`), ...commandArgs], {
      cwd: invocationCwd,
      encoding: output === "pipe" ? "utf8" : undefined,
      stdio: output,
    });
  }
  const packageName = name === "scanner" ? "@screenbranch/scanner" : "@screenbranch/capture";
  return spawnSync("pnpm", ["--filter", packageName, "exec", "tsx", "src/cli.ts", ...commandArgs], {
    cwd: repositoryRoot,
    encoding: output === "pipe" ? "utf8" : undefined,
    stdio: output,
  });
}

function runCapture(commandArgs, errorCode) {
  const result = runInternalCli("capture", commandArgs);
  if (result.status !== 0) {
    console.error(`\n${errorCode}: Capture did not finish. Review the last browser message, confirm ${baseUrl} still loads, then rerun the same command.`);
    console.error("Add --timing-json /tmp/screenwalk-timings.json when the failure is slow or intermittent.");
    process.exit(result.status ?? 1);
  }
}

async function startPackagedStudio() {
  const studioRoot = resolve(repositoryRoot, "dist/studio");
  if (!(await exists(resolve(studioRoot, "index.html")))) {
    throw new Error("Studio assets are missing from this Screenwalk package.");
  }
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (requestUrl.pathname === "/screenbranch.graph.json") return await sendFile(response, graphPath, "application/json; charset=utf-8");
      if (requestUrl.pathname === assetPrefix || requestUrl.pathname.startsWith(`${assetPrefix}/`)) {
        const relativeAsset = requestUrl.pathname.slice(assetPrefix.length).replace(/^\/+/, "");
        return await sendFile(response, safePath(assetsDirectory, relativeAsset));
      }
      const relativeStudioPath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
      const candidate = safePath(studioRoot, relativeStudioPath);
      if (await exists(candidate)) return await sendFile(response, candidate);
      return await sendFile(response, resolve(studioRoot, "index.html"), "text/html; charset=utf-8");
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Not found");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Studio server did not provide a local port.");
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
  return `http://127.0.0.1:${address.port}/?graph=local`;
}

function safePath(root, relativePath) {
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("Invalid Studio asset path.");
  return candidate;
}

async function sendFile(response, path, explicitType) {
  const content = await readFile(path);
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  response.writeHead(200, {
    "cache-control": path === graphPath ? "no-store" : "public, max-age=3600",
    "content-type": explicitType ?? types[extname(path).toLowerCase()] ?? "application/octet-stream",
  });
  response.end(content);
}

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function viewportTimingPath(path, viewport, persona = "default") {
  const absolutePath = resolve(path);
  if (viewports.length === 1 && persona === "default") return absolutePath;
  const suffix = persona === "default" ? viewport : `${viewport}-${persona}`;
  return absolutePath.endsWith(".json") ? `${absolutePath.slice(0, -5)}-${suffix}.json` : `${absolutePath}-${suffix}.json`;
}

async function readSetupSummary(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`SB_SETUP_INVALID: Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value?.schemaVersion !== "screenbranch.setup.v0" || typeof value.persona !== "string" || typeof value.label !== "string") {
    throw new Error(`SB_SETUP_INVALID: ${path} must be a screenbranch.setup.v0 recipe with persona and label.`);
  }
  return { persona: value.persona, label: value.label };
}

async function readIdentityPolicy(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`SB_IDENTITY_POLICY_INVALID: Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stringArray = (candidate) => Array.isArray(candidate) && candidate.every((item) => typeof item === "string" && item.length > 0);
  if (
    value?.schemaVersion !== "screenwalk.identity.v0" ||
    (value.query !== undefined && (!stringArray(value.query?.include ?? []) || !stringArray(value.query?.ignore ?? []))) ||
    (value.hash !== undefined && (!stringArray(value.hash?.include ?? []) || (value.hash.treatPathAsRoute !== undefined && typeof value.hash.treatPathAsRoute !== "boolean")))
  ) {
    throw new Error(`SB_IDENTITY_POLICY_INVALID: ${path} must use screenwalk.identity.v0 with string arrays for query.include, query.ignore, and hash.include.`);
  }
  return value;
}

async function assertReachable(url) {
  if (await reachable(url)) return;
  console.error(`\nSB_TARGET_UNREACHABLE: Screenwalk could not reach ${url}.`);
  console.error("Start that app's dev server, confirm the URL in a browser, then rerun this command with --url <working-url>.");
  process.exit(1);
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReachable(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await reachable(url)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Studio did not start at ${url}`);
}

async function readProjectName(root, fallback) {
  try {
    await access(resolve(root, "package.json"));
    return JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).name || basename(root);
  } catch {
    return basename(root) || fallback;
  }
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

function graphDiff(previous, current) {
  const before = new Map((previous?.nodes ?? []).map((node) => [node.id, node]));
  const after = new Map(current.nodes.map((node) => [node.id, node]));
  const addedNodeIds = [...after.keys()].filter((id) => !before.has(id));
  const removedNodeIds = [...before.keys()].filter((id) => !after.has(id));
  const changedNodeIds = [...after.entries()].filter(([id, node]) => {
    const old = before.get(id);
    if (!old) return false;
    const hashes = (value) => [
      value.captureVariants?.desktop?.contentHash,
      value.captureVariants?.mobile?.contentHash,
      value.sourceFile,
      value.stateKey,
      value.identity?.familyId,
      value.identity?.variantId,
      value.identity?.presentation?.kind,
      value.identity?.review?.status,
    ].join(":");
    return hashes(old) !== hashes(node);
  }).map(([id]) => id);
  return { previousRunId: previous?.run?.id, addedNodeIds, removedNodeIds, changedNodeIds };
}

function startSourceWatcher() {
  let timer;
  let running = false;
  const pendingRoutes = new Set();
  console.log(`\nWatching ${projectRoot} for UI source changes…`);
  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) return;
      running = true;
      const routes = [...pendingRoutes];
      pendingRoutes.clear();
      const temporaryGraph = `${graphPath}.next`;
      await copyFile(graphPath, temporaryGraph);
      const originalArgs = process.argv.slice(2);
      const childArgs = [];
      for (let index = 0; index < originalArgs.length; index += 1) {
        const value = originalArgs[index];
        if (value === "--watch" || value === "--no-open" || value === "--no-studio") continue;
        if (value === "--output" || value === "--routes") { index += 1; continue; }
        if (value === "--setup") { childArgs.push(value, setupPath); index += 1; continue; }
        childArgs.push(value);
      }
      childArgs.push("--no-open", "--no-studio", "--output", temporaryGraph);
      if (routes.length > 0) childArgs.push("--routes", routes.join(","));
      console.log(`\nChange detected · ${routes.length > 0 ? `recapturing ${routes.join(", ")}` : "refreshing the map"}`);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], { cwd: repositoryRoot, stdio: "inherit" });
      child.on("exit", async (code) => {
        if (code === 0) {
          await copyFile(temporaryGraph, graphPath);
          graph = JSON.parse(await readFile(graphPath, "utf8"));
          console.log("Studio updated; the previous good graph stayed visible until this capture completed.");
        } else {
          console.error("Recapture failed; Studio is still showing the last good graph.");
        }
        await unlink(temporaryGraph).catch(() => undefined);
        running = false;
        if (pendingRoutes.size > 0) scheduleRefresh();
      });
    }, 450);
  };
  const watcher = watch(projectRoot, { recursive: true }, (_event, filename) => {
    if (!filename || !isUiSourceFile(String(filename))) return;
    const normalized = String(filename).replaceAll("\\", "/");
    for (const node of graph.nodes) if (node.sourceFile === normalized && node.stateKey === "default") pendingRoutes.add(node.route);
    scheduleRefresh();
  });
  process.on("SIGINT", () => watcher.close());
}

async function runDoctor(rawDoctorArgs) {
  const json = rawDoctorArgs.includes("--json");
  const value = (name, fallback) => {
    const index = rawDoctorArgs.indexOf(name);
    return index >= 0 ? rawDoctorArgs[index + 1] : fallback;
  };
  const positionalDoctor = rawDoctorArgs.filter((item, index) => !item.startsWith("--") && (index === 0 || !rawDoctorArgs[index - 1]?.startsWith("--")));
  const root = resolve(positionalDoctor[0] ?? ".");
  const url = value("--url", "http://127.0.0.1:3000");
  const checks = [];
  const add = (id, ok, detail, severity = "error") => checks.push({ id, ok, severity, detail });
  add("node", Number(process.versions.node.split(".")[0]) >= 20, `Node ${process.versions.node}; version 20 or newer is required.`);
  add("project", await exists(root), root);
  add("package", await exists(resolve(root, "package.json")), "Optional: package.json gives the map a stable project identity; plain HTML works without one.", "warning");
  add("source-mode", await exists(resolve(root, "app")) || await exists(resolve(root, "src/app")), "Next.js App Router source scanning is available; HTML and other apps use browser-first discovery.", "warning");
  add("target", await reachable(url), `${url} must already be running.`);
  const explicitIdentityPolicy = value("--identity-policy");
  const doctorIdentityPolicy = explicitIdentityPolicy ? resolve(explicitIdentityPolicy) : resolve(root, "screenwalk.identity.json");
  if (explicitIdentityPolicy || await exists(doctorIdentityPolicy)) {
    try {
      await readIdentityPolicy(doctorIdentityPolicy);
      add("identity", true, `${doctorIdentityPolicy} is valid.`);
    } catch (error) {
      add("identity", false, error instanceof Error ? error.message : String(error));
    }
  }
  const ok = checks.every((check) => check.ok || check.severity === "warning");
  if (json) console.log(JSON.stringify({ ok, project: root, url, checks }));
  else {
    console.log(`Screenwalk doctor · ${ok ? "ready" : "needs attention"}`);
    for (const check of checks) console.log(`${check.ok ? "✓" : check.severity === "warning" ? "○" : "✗"} ${check.id.padEnd(12)} ${check.detail}`);
  }
  process.exitCode = ok ? 0 : 1;
}

function readGitRevision(root) {
  const sha = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (sha.status !== 0) return undefined;
  const branch = spawnSync("git", ["-C", root, "symbolic-ref", "--short", "-q", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" });
  if (status.status !== 0) return undefined;
  return {
    sha: sha.stdout.trim(),
    branch: branch.status === 0 ? branch.stdout.trim() : "detached",
    dirty: status.stdout.trim().length > 0,
  };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}
