#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const required = (name) => {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const surfaces = args.flatMap((value, index) => value === "--surface" ? [args[index + 1]] : []).filter(Boolean).map((value) => {
  const [id, label, referencePath, candidatePath] = value.split("::");
  if (!id || !label || !referencePath || !candidatePath) throw new Error(`Invalid --surface ${value}; expected id::label::reference.json::candidate.json`);
  return { id, label, referencePath: resolve(referencePath), candidatePath: resolve(candidatePath) };
});
if (surfaces.length === 0) throw new Error("At least one --surface is required");

const loadedSurfaces = await Promise.all(surfaces.map(async (surface) => ({
  ...surface,
  reference: await readGraph(surface.referencePath),
  candidate: await readGraph(surface.candidatePath),
})));
const capturedAt = new Date().toISOString();
const manifest = {
  schemaVersion: "screenwalk.comparison.v0",
  project: { name: required("--project") },
  reference: revision("reference", loadedSurfaces.map((surface) => surface.reference), capturedAt),
  candidate: revision("candidate", loadedSurfaces.map((surface) => surface.candidate), capturedAt),
  surfaces: loadedSurfaces.map(compareSurface),
};
if (manifest.reference.evidence !== manifest.candidate.evidence) {
  throw new Error("Reference and candidate must use the same evidence level; runtime and source-only graphs cannot be mixed");
}
await writeFile(resolve(required("--out")), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function revision(side, graphs, sourceCapturedAt) {
  const proofs = graphs.map(runtimeProof);
  const runtimeCount = proofs.filter(Boolean).length;
  if (runtimeCount > 0 && runtimeCount !== graphs.length) throw new Error(`${side} surfaces mix runtime-proven and source-only graphs`);
  if (runtimeCount === graphs.length) {
    const first = proofs[0];
    for (const proof of proofs.slice(1)) {
      for (const field of ["sha", "branch", "dirty", "environment", "url", "deploymentId", "capturedAt"]) {
        if (proof[field] !== first[field]) throw new Error(`${side} runtime graphs disagree on ${field}`);
      }
    }
    assertExpected(side, "sha", first.sha);
    assertExpected(side, "branch", first.branch);
    assertExpected(side, "environment", first.environment);
    assertExpected(side, "url", first.url);
    assertExpected(side, "deployment-id", first.deploymentId);
    return {
      label: required(`--${side}-label`),
      environment: first.environment,
      git: { sha: first.sha, branch: first.branch, dirty: false },
      deployment: { ...(first.deploymentId ? { id: first.deploymentId } : {}), url: first.url },
      capturedAt: first.capturedAt,
      evidence: "runtime",
    };
  }

  if (option(`--${side}-url`) || option(`--${side}-deployment-id`)) {
    throw new Error(`${side} graph has no complete, clean, captured runtime proof; deployment arguments cannot upgrade source evidence`);
  }
  return {
    label: required(`--${side}-label`),
    environment: required(`--${side}-environment`),
    git: { sha: required(`--${side}-sha`), branch: required(`--${side}-branch`), dirty: false },
    capturedAt: sourceCapturedAt,
    evidence: "source",
  };
}

function runtimeProof(graph) {
  const run = graph?.run;
  if (run?.status !== "complete" || !run.completedAt || !run.revision || run.revision.dirty || !run.deployment?.url || !run.baseUrl || capturedRoutes(graph).size === 0) return undefined;
  if (new URL(run.deployment.url).href !== new URL(run.baseUrl).href) throw new Error("Graph deployment URL does not match its captured base URL");
  return {
    sha: run.revision.sha,
    branch: run.revision.branch,
    dirty: run.revision.dirty,
    environment: run.environment ?? "unknown",
    url: run.deployment.url,
    deploymentId: run.deployment.id,
    capturedAt: run.completedAt,
  };
}

function assertExpected(side, field, actual) {
  const expected = option(`--${side}-${field}`);
  if (expected !== undefined && expected !== actual) throw new Error(`${side} ${field} expectation ${expected} does not match graph evidence ${actual ?? "(missing)"}`);
}

function compareSurface(surface) {
  const { reference, candidate } = surface;
  const referenceByRoute = new Map(reference.nodes.filter(isDefaultScreen).map((node) => [node.route, node]));
  const candidateByRoute = new Map(candidate.nodes.filter(isDefaultScreen).map((node) => [node.route, node]));
  const referenceRoutes = new Set(referenceByRoute.keys());
  const candidateRoutes = new Set(candidateByRoute.keys());
  const sharedRoutes = [...referenceRoutes].filter((route) => candidateRoutes.has(route)).sort();
  const onlyReferenceRoutes = [...referenceRoutes].filter((route) => !candidateRoutes.has(route)).sort();
  const onlyCandidateRoutes = [...candidateRoutes].filter((route) => !referenceRoutes.has(route)).sort();
  const referencePaths = edgeKeys(reference);
  const candidatePaths = edgeKeys(candidate);
  const referenceCapturedRoutes = capturedRoutes(reference);
  const candidateCapturedRoutes = capturedRoutes(candidate);
  const sharedCaptured = [...referenceCapturedRoutes].filter((route) => candidateCapturedRoutes.has(route));
  return {
    id: surface.id,
    label: surface.label,
    summary: {
      referenceScreens: referenceRoutes.size,
      candidateScreens: candidateRoutes.size,
      sharedScreens: sharedRoutes.length,
      onlyReference: onlyReferenceRoutes.length,
      onlyCandidate: onlyCandidateRoutes.length,
      removedPaths: [...referencePaths].filter((path) => !candidatePaths.has(path)).length,
      addedPaths: [...candidatePaths].filter((path) => !referencePaths.has(path)).length,
      referenceCaptured: referenceCapturedRoutes.size,
      candidateCaptured: candidateCapturedRoutes.size,
      sharedCaptured: sharedCaptured.length,
    },
    sharedRoutes,
    changes: [
      ...onlyReferenceRoutes.map((route) => change(surface.id, route, "only-reference", referenceByRoute.get(route))),
      ...onlyCandidateRoutes.map((route) => change(surface.id, route, "only-candidate", candidateByRoute.get(route))),
      ...sharedRoutes.filter((route) => referenceCapturedRoutes.has(route) !== candidateCapturedRoutes.has(route)).map((route) => change(surface.id, route, "evidence-missing", candidateByRoute.get(route) ?? referenceByRoute.get(route))),
    ],
  };
}

function capturedRoutes(graph) {
  return new Set((graph?.nodes ?? []).filter((node) => isDefaultScreen(node) && (node.captureVariants?.desktop?.quality === "ready" || node.captureVariants?.mobile?.quality === "ready")).map((node) => node.route));
}

async function readGraph(path) {
  const graph = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges)) throw new Error(`${path} is not a Screenwalk graph`);
  return graph;
}

function isDefaultScreen(node) {
  return node.stateKey === "default" && node.persona === "default";
}

function edgeKeys(graph) {
  const routeById = new Map(graph.nodes.map((node) => [node.id, node.route]));
  return new Set(graph.edges.map((edge) => `${routeById.get(edge.source)}->${routeById.get(edge.target)}`));
}

function change(surfaceId, route, status, node) {
  return { id: createHash("sha1").update(`${surfaceId}:${status}:${route}`).digest("hex").slice(0, 12), route, title: node?.title ?? route, status, sourceFile: node?.sourceFile };
}
