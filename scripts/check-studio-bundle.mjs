#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const distDirectory = resolve(import.meta.dirname, "../apps/studio/dist");
const assetsDirectory = resolve(distDirectory, "assets");
const html = await readFile(resolve(distDirectory, "index.html"), "utf8");
const entrySource = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];

if (!entrySource) {
  console.error("Studio bundle check failed: dist/index.html has no module entry.");
  process.exit(1);
}

const entryPath = resolve(distDirectory, entrySource.replace(/^\//, ""));
const entryBytes = (await stat(entryPath)).size;
const javascriptAssets = (await readdir(assetsDirectory)).filter((file) => file.endsWith(".js"));
const chunks = await Promise.all(javascriptAssets.map(async (file) => ({
  file,
  bytes: (await stat(resolve(assetsDirectory, file))).size,
})));
const largestChunk = chunks.sort((left, right) => right.bytes - left.bytes)[0];
const entryLimit = 300_000;
const chunkLimit = 500_000;

if (entryBytes > entryLimit || largestChunk.bytes > chunkLimit) {
  console.error(`Studio bundle check failed: entry ${format(entryBytes)} / ${format(entryLimit)}, largest chunk ${largestChunk.file} ${format(largestChunk.bytes)} / ${format(chunkLimit)}.`);
  process.exit(1);
}

console.log(`Studio bundle budget · entry ${format(entryBytes)} · largest chunk ${largestChunk.file} ${format(largestChunk.bytes)}`);

function format(bytes) {
  return `${(bytes / 1_000).toFixed(1)} kB`;
}
