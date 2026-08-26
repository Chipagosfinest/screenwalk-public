#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(resolve(tmpdir(), "screenwalk-clean-checkout-"));

try {
  run("git", ["archive", "--format=tar", "HEAD", "-o", resolve(temporaryRoot, "screenwalk.tar")], root);
  run("tar", ["-xf", "screenwalk.tar", "-C", temporaryRoot], temporaryRoot);
  await rm(resolve(temporaryRoot, "screenwalk.tar"));
  run("pnpm", ["install", "--frozen-lockfile"], temporaryRoot);
  const help = run("pnpm", ["screenwalk", "--help"], temporaryRoot, true);
  assert.match(help.stdout, /^Screenwalk /);
  assert.match(help.stdout, /plain HTML|running product/);
  run("pnpm", ["test"], temporaryRoot);
  run("pnpm", ["typecheck"], temporaryRoot);
  run("pnpm", ["build"], temporaryRoot);
  console.log(`Clean-checkout verification passed in ${temporaryRoot}`);
} catch (error) {
  console.error(`Clean-checkout verification failed. Inspect ${temporaryRoot}`);
  throw error;
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit", timeout: 120_000 });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed${result.stderr ? `: ${result.stderr}` : ""}`);
  return result;
}
