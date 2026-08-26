#!/usr/bin/env node

import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    cli: "scripts/screenbranch.mjs",
    scanner: "packages/scanner/src/cli.ts",
    capture: "packages/capture/src/cli.ts",
  },
  outdir: output,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  external: ["playwright", "playwright-core"],
  define: {
    "process.env.SCREENWALK_PACKAGED_RUNTIME": '"1"',
  },
});

await cp(resolve(root, "apps/studio/dist"), resolve(output, "studio"), { recursive: true });
console.log("Built npm package in dist/");
