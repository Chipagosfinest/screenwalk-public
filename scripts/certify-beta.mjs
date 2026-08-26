#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspace = await mkdtemp(resolve(tmpdir(), "screenwalk-certification-"));
const processes = [];
const results = [];

try {
  const htmlPort = await freePort();
  const spaPort = await freePort();
  const gatePort = await freePort();

  processes.push(start(process.execPath, ["server.mjs"], resolve(root, "fixtures/html-app"), { SCREENWALK_HTML_PORT: String(htmlPort) }));
  processes.push(start("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(spaPort)], resolve(root, "fixtures/vite-spa")));
  processes.push(start(process.execPath, ["server.mjs"], resolve(root, "fixtures/gated-app"), { SCREENWALK_GATE_PORT: String(gatePort), SCREENWALK_GATE_PASSWORD: "fixture-only" }));

  await Promise.all([htmlPort, spaPort, gatePort].map(waitForPort));
  const html = await capture("html", "fixtures/html-app", htmlPort, ["--discover-depth", "2"], undefined, {}, "desktop,mobile");
  assert.deepEqual(readyRoutes(html.graph), ["/", "/about.html", "/compare.html", "/plans.html"]);
  assert.equal(html.graph.edges.some((edge) => edge.action.includes("Delete account")), false, "consequential HTML route was clicked");
  assert.equal(html.graph.edges.some((edge) => edge.action.includes("mirrored")), false, "unchanged catch-all content became an observed transition");
  assert.equal(html.graph.nodes.flatMap((node) => node.interactiveTargets).find((target) => target.name === "Open mirrored route")?.status, "failed");
  assert.equal(html.graph.nodes.find((node) => node.route === "/mirror.html")?.captureVariants?.mobile, undefined, "failed destination was promoted by secondary viewport capture");
  assert.equal(html.graph.nodes.filter((node) => node.captureVariants?.mobile?.quality === "ready").length, 4);
  assert.equal(html.graph.nodes.flatMap((node) => node.interactiveTargets).find((target) => target.name === "Delete account")?.status, "unsafe");
  assert.equal(html.graph.nodes.flatMap((node) => node.interactiveTargets).find((target) => target.name === "External proof")?.status, "blocked");
  assert.ok(html.graph.journeys.some((journey) => journey.nodeIds.length === 3), "HTML flow did not compose through a second level");

  const verified = await record("html-verified", html.graphPath, htmlPort, resolve(root, "examples/html-plans.recipe.json"));
  const verifiedJourney = verified.graph.journeys.find((journey) => journey.id === "journey:html-plans");
  assert.equal(verifiedJourney?.provenance, "verified-end-to-end");
  assert.equal(verified.receipt.status, "passed");
  assert.equal(verified.receipt.terminalAssertion.type, "visible-role");
  assert.deepEqual(verified.receipt.conditions.map(({ kind, label }) => ({ kind, label })), [{ kind: "access", label: "public visitor" }]);
  assert.equal(verified.graph.edges.find((edge) => edge.id === verifiedJourney.edgeIds[0])?.conditions?.[0]?.label, "public visitor");
  assert.equal(verified.receipt.artifacts.trace, null, "bounded verdict slice must not create a trace implicitly");

  const variants = await record("html-path-variants", html.graphPath, htmlPort, resolve(root, "examples/html-path-variants.recipe.json"), true, 2);
  const variantReceipts = new Map(variants.receipts.map((receipt) => [receipt.journeyId, receipt]));
  assert.deepEqual([...variantReceipts.keys()].sort(), ["journey:html-path-variant-a", "journey:html-path-variant-b"]);
  assert.equal(variantReceipts.get("journey:html-path-variant-a")?.status, "passed");
  assert.equal(variantReceipts.get("journey:html-path-variant-a")?.conditions[0]?.value, "A");
  assert.equal(variantReceipts.get("journey:html-path-variant-b")?.status, "passed");
  assert.equal(variantReceipts.get("journey:html-path-variant-b")?.conditions[0]?.value, "B");

  const repeatedVariants = await record("html-path-variants", html.graphPath, htmlPort, resolve(root, "examples/html-path-variants.recipe.json"), true, 4);
  assert.equal(new Set(repeatedVariants.receipts.map((receipt) => receipt.runId)).size, 4, "repeated A/B runs must append distinct receipts");
  assert.deepEqual(Object.fromEntries(["A", "B"].map((value) => [value, repeatedVariants.receipts.filter((receipt) => receipt.conditions[0]?.value === value).length])), { A: 2, B: 2 });

  const brokenA = await record("html-variant-a-broken", html.graphPath, htmlPort, resolve(root, "examples/html-path-variant-a-broken.recipe.json"), false);
  const brokenB = await record("html-variant-b-broken", html.graphPath, htmlPort, resolve(root, "examples/html-path-variant-b-broken.recipe.json"), false);
  for (const [label, broken] of [["A", brokenA], ["B", brokenB]]) {
    assert.equal(broken.status, 1, `a broken variant ${label} assertion must fail the record command`);
    assert.equal(broken.receipt.status, "failed");
    assert.equal(broken.receipt.conditions[0]?.value, label);
    assert.match(broken.receipt.error, /Expected visible text/);
  }

  const htmlRepeat = await capture("html", "fixtures/html-app", htmlPort, ["--discover-depth", "2"], html.graphPath, {}, "desktop,mobile");
  assert.deepEqual(readyRoutes(htmlRepeat.graph), readyRoutes(html.graph), "repeat capture changed stable routes");
  assert.deepEqual(htmlRepeat.graph.diff?.addedNodeIds, []);
  assert.deepEqual(htmlRepeat.graph.diff?.removedNodeIds, []);
  assert.deepEqual(htmlRepeat.graph.diff?.changedNodeIds, []);
  const overlays = await record("html-overlay-states", htmlRepeat.graphPath, htmlPort, resolve(root, "examples/html-overlay-states.recipe.json"), true, 2);
  const overlayNodes = overlays.graph.nodes.filter((node) => node.identity?.presentation.kind === "modal" || node.identity?.presentation.kind === "drawer");
  assert.deepEqual(overlayNodes.map((node) => node.identity.presentation.kind).sort(), ["drawer", "modal"]);
  assert.ok(overlayNodes.every((node) => node.capture?.quality === "ready"), "overlay states must have ready screenshots");
  assert.ok(overlayNodes.every((node) => node.route === "/"), "overlay states must preserve the source route");
  assert.ok(overlays.receipts.every((receipt) => receipt.status === "passed" && receipt.asserted), "overlay journeys must pass their visible dialog assertions");
  assert.ok(overlays.graph.edges.filter((edge) => overlayNodes.some((node) => node.id === edge.target)).every((edge) => edge.observations?.[0]?.fromUrl === edge.observations?.[0]?.toUrl), "same-route overlay transitions must preserve URL evidence");
  assert.deepEqual(overlays.graph.nodes.find((node) => node.id === "screen:root")?.interactiveTargets.filter((target) => target.status === "observed" && target.role === "button").map((target) => target.name).sort(), ["Invite people", "Review activity"], "explicit overlay triggers must remain observed across multiple journeys");
  results.push(fact("plain-html", overlays.graph, { repeatStable: true, unsafeRouteWithheld: true, unchangedDestinationWithheld: true, terminalVerdictPassed: true, variantAPassed: true, variantBPassed: true, brokenVariantsFailedIndependently: true, repeatedReceiptsAppended: true, modalStateRecorded: true, drawerStateRecorded: true }));

  const spa = await capture("vite-spa", "fixtures/vite-spa", spaPort, ["--discover-depth", "3"]);
  assert.deepEqual(readyRoutes(spa.graph), ["/", "/projects", "/projects/new", "/settings"]);
  assert.ok(spa.graph.edges.every((edge) => edge.observations?.length), "SPA edges must be observed, not inferred");
  assert.ok(spa.graph.journeys.some((journey) => journey.nodeIds.length === 3), "SPA flow did not reach its leaf screen");
  results.push(fact("client-routed-vite", spa.graph));

  const gated = await capture("gated", "fixtures/gated-app", gatePort, ["--discover-depth", "2", "--setup", resolve(root, "examples/preview-access.setup.json")], undefined, { SCREENWALK_PREVIEW_PASSWORD: "fixture-only" });
  assert.deepEqual([...new Set(gated.graph.nodes.map((node) => node.persona))].sort(), ["default", "preview"]);
  assert.equal(gated.graph.nodes.find((node) => node.persona === "default")?.capture?.title, "Access required");
  assert.ok(gated.graph.nodes.some((node) => node.persona === "preview" && node.route === "/inside"));
  assert.equal(JSON.stringify(gated.graph).includes("fixture-only"), false, "setup secret leaked into graph");
  const persisted = await readFile(gated.graphPath, "utf8");
  assert.equal(persisted.includes("fixture-only"), false, "setup secret leaked into persisted evidence");
  results.push(fact("auth-gated-html", gated.graph, { publicAndPreviewSeparated: true, secretPersisted: false }));

  const report = {
    schemaVersion: "screenwalk.beta-certification.v1",
    generatedAt: new Date().toISOString(),
    workspace,
    results,
    status: "pass",
  };
  const reportPath = resolve(workspace, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nBeta certification passed: ${reportPath}`);
  for (const result of results) console.log(`✓ ${result.target}: ${result.screens} screens · ${result.observedTransitions} observed transitions · ${result.journeys} journeys`);
} catch (error) {
  console.error(`\nBeta certification failed. Artifacts remain at ${workspace}`);
  throw error;
} finally {
  for (const child of processes) child.kill("SIGTERM");
}

async function capture(name, project, port, extraArgs, existingGraphPath, extraEnvironment = {}, viewports = "desktop") {
  const directory = resolve(workspace, name);
  const graphPath = existingGraphPath ?? resolve(directory, "graph.json");
  const args = [
    resolve(root, "scripts/screenbranch.mjs"), resolve(root, project),
    "--url", `http://127.0.0.1:${port}`,
    "--viewports", viewports,
    "--no-open", "--no-studio",
    "--output", graphPath,
    "--assets-dir", resolve(directory, "assets"),
    "--asset-prefix", "/captures",
    "--runs-dir", resolve(directory, "runs"),
    ...extraArgs,
  ];
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...extraEnvironment }, encoding: "utf8", timeout: 90_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${name} capture failed`);
  return { graphPath, graph: JSON.parse(await readFile(graphPath, "utf8")) };
}

async function record(name, graphPath, port, recipePath, expectSuccess = true, expectedReceiptCount = 1) {
  const directory = resolve(workspace, name);
  const receiptsDirectory = resolve(directory, "receipts");
  const result = spawnSync("pnpm", [
    "--filter", "@screenbranch/capture", "record", graphPath,
    "--base-url", `http://127.0.0.1:${port}`,
    "--assets-dir", resolve(directory, "assets"),
    "--asset-prefix", "/captures",
    "--out", graphPath,
    "--recipe", recipePath,
    "--receipts-dir", receiptsDirectory,
  ], { cwd: root, encoding: "utf8", timeout: 30_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (expectSuccess) assert.equal(result.status, 0, `${name} record failed`);
  const receiptFiles = (await readdir(receiptsDirectory)).filter((file) => file.endsWith(".json"));
  assert.equal(receiptFiles.length, expectedReceiptCount, `${name} must contain ${expectedReceiptCount} receipt(s)`);
  const receipts = await Promise.all(receiptFiles.map(async (file) => JSON.parse(await readFile(resolve(receiptsDirectory, file), "utf8"))));
  return {
    status: result.status,
    graph: JSON.parse(await readFile(graphPath, "utf8")),
    receipt: receipts[0],
    receipts,
  };
}

function fact(target, graph, assertions = {}) {
  return {
    target,
    framework: graph.project.framework,
    screens: graph.nodes.filter((node) => node.captureVariants?.desktop?.quality === "ready").length,
    mobileScreens: graph.nodes.filter((node) => node.captureVariants?.mobile?.quality === "ready").length,
    observedTransitions: graph.edges.filter((edge) => edge.observations?.length).length,
    journeys: graph.journeys.length,
    assertions,
  };
}

function readyRoutes(graph) {
  return graph.nodes.filter((node) => node.captureVariants?.desktop?.quality === "ready").map((node) => node.route).sort();
}

function start(command, args, cwd, environment = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[fixture] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[fixture] ${chunk}`));
  return child;
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForPort(port) {
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Fixture did not start at ${url}`);
}
