#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "screenwalk-package-"));
const consumerRoot = resolve(temporaryRoot, "consumer");
let fixture;

try {
  run("pnpm", ["build:package"], root);
  const packed = run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot], root, true);
  const packReport = JSON.parse(packed.stdout)[0];
  assert.equal(packReport.name, "screenwalk");
  assert.ok(packReport.entryCount < 30, `Expected fewer than 30 package files, received ${packReport.entryCount}`);
  assert.ok(packReport.files.every(({ path }) => path === "README.md" || path === "LICENSE" || path === "package.json" || path.startsWith("dist/")), "Package contains files outside the release allowlist");

  await writeFile(resolve(temporaryRoot, "pack-report.json"), `${JSON.stringify(packReport, null, 2)}\n`);
  run("mkdir", ["-p", consumerRoot], temporaryRoot);
  run("npm", ["init", "-y"], consumerRoot);
  run("npm", ["install", "--ignore-scripts", resolve(temporaryRoot, packReport.filename)], consumerRoot);

  const cli = resolve(consumerRoot, "node_modules/.bin/screenwalk");
  const help = run(cli, ["--help"], consumerRoot, true);
  assert.match(help.stdout, /^Screenwalk /);
  assert.match(help.stdout, /npx screenwalk/);
  assert.doesNotMatch(help.stdout, /pnpm screenwalk/);

  const topology = run(cli, ["inspect", resolve(root, "fixtures/next-app")], consumerRoot, true);
  assert.equal(JSON.parse(topology.stdout).schemaVersion, "screenwalk.topology.v0");

  const fixturePort = String(40_000 + (process.pid % 20_000));
  fixture = spawn(process.execPath, [resolve(root, "fixtures/html-app/server.mjs")], {
    cwd: root,
    env: { ...process.env, SCREENWALK_HTML_PORT: fixturePort },
    stdio: "ignore",
  });
  await waitForUrl(`http://127.0.0.1:${fixturePort}`);
  await runStudioCapture(cli, [resolve(root, "fixtures/html-app"), "--url", `http://127.0.0.1:${fixturePort}`, "--viewports", "desktop", "--max-screens", "3", "--no-open"], consumerRoot);

  const graph = JSON.parse(await readFile(resolve(consumerRoot, ".screenwalk/screenbranch.graph.json"), "utf8"));
  assert.equal(graph.run.status, "complete");
  assert.ok(graph.nodes.some((node) => node.captureVariants?.desktop?.quality === "ready"));
  console.log(`Verified packed Screenwalk CLI: ${packReport.entryCount} files, ${packReport.unpackedSize} bytes unpacked`);
} finally {
  fixture?.kill("SIGTERM");
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit", timeout: 180_000 });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed${result.stderr ? `: ${result.stderr}` : ""}`);
  return result;
}

async function waitForUrl(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Fixture did not start at ${url}`);
}

async function runStudioCapture(command, args, cwd) {
  const child = spawn(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    const studioUrl = await new Promise((resolveUrl, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Packaged Studio did not start.\n${stdout}\n${stderr}`)), 60_000);
      const inspect = () => {
        const match = stdout.match(/Studio ready at (http:\/\/127\.0\.0\.1:\d+\/\?graph=local)/);
        if (!match) return;
        clearTimeout(deadline);
        resolveUrl(match[1]);
      };
      child.stdout.on("data", inspect);
      child.once("exit", (code) => {
        clearTimeout(deadline);
        reject(new Error(`Packaged Screenwalk exited before Studio started (${code}).\n${stdout}\n${stderr}`));
      });
    });
    const studioResponse = await fetch(studioUrl);
    assert.equal(studioResponse.status, 200);
    assert.match(await studioResponse.text(), /<title>Screenwalk Studio<\/title>/);
    const graphResponse = await fetch(new URL("/screenbranch.graph.json", studioUrl));
    assert.equal(graphResponse.status, 200);
  } finally {
    child.kill("SIGTERM");
  }
}
