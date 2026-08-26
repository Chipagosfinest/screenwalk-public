#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenPaths = [
  /^docs\/(?:research|validation)\//,
  /^output\//,
  /^apps\/studio\/public\/captures\/(?!fixture\/)/,
  /^apps\/studio\/src\/data\/(?:visa-comparison|nested-graph|stumble-graph|stumble-recipe)\.json$/,
];
const forbiddenText = [
  { label: "absolute user path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { label: "private dogfood product", pattern: /\b(?:ProductRank|Stumble|Nested)\b/ },
  { label: "private payment-product evidence", pattern: /\bVisa(?:-mono)?\b/ },
  { label: "old private remote", pattern: /Chipagosfinest\/screenwalk(?!-public)/ },
];
const textExtensions = /\.(?:c?js|mjs|ts|tsx|json|md|yml|yaml|html|css|txt)$/;
const failures = [];

for (const file of tracked) {
  if (file === "scripts/check-public-corpus.mjs") continue;
  if (forbiddenPaths.some((pattern) => pattern.test(file))) failures.push(`${file}: forbidden public path`);
  if (!textExtensions.test(file) || statSync(file).size > 1_000_000) continue;
  const source = readFileSync(file, "utf8");
  for (const check of forbiddenText) {
    if (check.pattern.test(source)) failures.push(`${file}: ${check.label}`);
  }
}

if (failures.length > 0) {
  console.error("Public corpus check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Public corpus check passed · ${tracked.length} tracked files · synthetic fixture captures only`);
