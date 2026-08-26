#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { flowGraphSchema } from "@screenbranch/schema";
import { scanRepository } from "./scanner.ts";
import { inspectRepository } from "./topology.ts";

const [, , command, ...rawArgs] = process.argv;
const normalizedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const [targetArg = ".", ...args] = normalizedArgs;

if (command === "validate") {
  try {
    const graph = flowGraphSchema.parse(JSON.parse(await readFile(resolve(targetArg), "utf8")));
    console.log(JSON.stringify({ ok: true, schemaVersion: graph.schemaVersion, nodes: graph.nodes.length, edges: graph.edges.length, journeys: graph.journeys.length, gaps: graph.gaps.length }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  }
  process.exit(0);
}

if (command === "inspect") {
  try {
    const topology = await inspectRepository(resolve(targetArg));
    const outputIndex = args.indexOf("--out");
    const outputArg = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
    if (outputArg) {
      const output = resolve(outputArg);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(topology, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(topology, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  process.exit(0);
}

if (command !== "scan") {
  console.error("Usage: screenwalk <inspect project [--out topology.json] | scan project [--service id] --out graph.json | validate graph.json>");
  process.exit(2);
}

const outIndex = args.indexOf("--out");
const outputArg = outIndex >= 0 ? args[outIndex + 1] : undefined;
const output = resolve(outputArg ?? "screenbranch.graph.json");

try {
  const serviceIndex = args.indexOf("--service");
  const service = serviceIndex >= 0 ? args[serviceIndex + 1] : undefined;
  const graph = await scanRepository(resolve(targetArg), service);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  console.log(`Mapped ${graph.nodes.length} screens and ${graph.edges.length} static transitions.`);
  console.log(`Recorded ${graph.journeys.length} journeys and ${graph.gaps.length} explicit gaps.`);
  console.log(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
