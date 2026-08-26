import assert from "node:assert/strict";
import test from "node:test";
import type { FlowGraph, ScreenNode } from "@screenbranch/schema";
import { collapseDynamicRouteInstances, matchingRouteTemplate, routeTemplateMatches } from "./route-families.ts";

test("matches concrete Next.js paths to the most specific dynamic route template", () => {
  assert.equal(routeTemplateMatches("/s/[id]", "/s/ea9aeefb-6047"), true);
  assert.equal(routeTemplateMatches("/s/[id]", "/s"), false);
  assert.equal(routeTemplateMatches("/docs/[...slug]", "/docs/api/auth"), true);
  assert.equal(routeTemplateMatches("/docs/[[...slug]]", "/docs"), true);
  assert.equal(matchingRouteTemplate(["/[section]/[id]", "/s/[id]"], "/s/123"), "/s/[id]");
});

test("collapses content instances into one dynamic screen without losing browser proof", () => {
  const template = node("screen:s:[id]", "Search", "/s/[id]", "app/s/[id]/page.tsx");
  const first = capturedNode("screen:runtime:first", "/s/first", "first.png");
  const second = capturedNode("screen:runtime:second", "/s/second", "second.png");
  const graph: FlowGraph = {
    schemaVersion: "screenbranch.graph.v0",
    project: { name: "fixture", root: "/fixture", framework: "next-app-router", generatedAt: "2026-08-18T00:00:00.000Z" },
    nodes: [node("screen:root", "Home", "/", "app/page.tsx"), template, first, second],
    edges: [edge("edge:first", first.id), edge("edge:second", second.id)],
    journeys: [
      { id: "journey:first", title: "Home to first", nodeIds: ["screen:root", first.id], edgeIds: ["edge:first"], kind: "observed" },
      { id: "journey:second", title: "Home to second", nodeIds: ["screen:root", second.id], edgeIds: ["edge:second"], kind: "observed" },
    ],
    gaps: [],
  };

  const collapsed = collapseDynamicRouteInstances(graph);

  assert.deepEqual(collapsed.nodes.map((candidate) => candidate.id), ["screen:root", template.id]);
  assert.equal(collapsed.nodes[1]?.capture?.asset, "first.png");
  assert.match(collapsed.nodes[1]?.evidence.at(-1)?.detail ?? "", /2 concrete URLs/);
  assert.equal(collapsed.edges.length, 1);
  assert.equal(collapsed.edges[0]?.id, "edge:observed:screen:root:screen:s:[id]:route-family");
  assert.equal(collapsed.edges[0]?.target, template.id);
  assert.equal(collapsed.edges[0]?.observations?.length, 2);
  assert.equal(collapsed.journeys.length, 1);
  assert.deepEqual(collapsed.journeys[0]?.nodeIds, ["screen:root", template.id]);
  assert.equal(collapsed.journeys[0]?.title, "Home → Search");
});

test("keeps meaningful query states as variants instead of collapsing them into record content", () => {
  const template = node("screen:products:[id]", "Product", "/products/[id]", "app/products/[id]/page.tsx");
  const details = capturedNode("screen:runtime:details", "/products/123?tab=details", "details.png");
  const graph: FlowGraph = {
    schemaVersion: "screenbranch.graph.v0",
    project: { name: "fixture", root: "/fixture", framework: "next-app-router", generatedAt: "2026-08-18T00:00:00.000Z" },
    nodes: [node("screen:root", "Home", "/", "app/page.tsx"), template, details],
    edges: [edge("edge:details", details.id)],
    journeys: [],
    gaps: [],
  };

  const collapsed = collapseDynamicRouteInstances(graph);
  assert.equal(collapsed.nodes.some((candidate) => candidate.id === details.id), true);
});

function node(id: string, title: string, route: string, sourceFile: string): ScreenNode {
  return { id, title, route, sourceFile, kind: "page", stateKey: "default", confidence: 1, persona: "default", diagnostics: [], interactiveTargets: [], evidence: [{ kind: "static", detail: "fixture" }] };
}

function capturedNode(id: string, route: string, asset: string): ScreenNode {
  const capture = { kind: "captured" as const, quality: "ready" as const, asset, url: `https://example.com${route}`, title: route, observedAt: "2026-08-18T00:00:00.000Z", viewport: { width: 1280, height: 800 } };
  return { ...node(id, route, route, "(browser discovery)"), capture, captureVariants: { desktop: capture }, evidence: [{ kind: "observed", detail: route }] };
}

function edge(id: string, target: string) {
  return {
    id,
    source: "screen:root",
    target,
    action: `Open ${target}`,
    confidence: 1,
    observations: [{ id: `observation:${id}`, observedAt: "2026-08-18T00:00:00.000Z", fromUrl: "https://example.com/", toUrl: `https://example.com/${target}`, durationMs: 1, trigger: { kind: "click" as const, role: "link" as const, name: target } }],
    evidence: [{ kind: "observed" as const, detail: id }],
  };
}
