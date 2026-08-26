import assert from "node:assert/strict";
import test from "node:test";
import { flowGraphSchema } from "@screenbranch/schema";
import { composeObservedJourneys } from "./journeys.ts";

const observedAt = "2026-08-16T00:00:00.000Z";
const graph = flowGraphSchema.parse({
  schemaVersion: "screenbranch.graph.v0",
  project: { name: "fixture", root: "/tmp/fixture", framework: "web", generatedAt: observedAt },
  nodes: [
    ["home", "Home", "/"],
    ["choose", "Choose plan", "/plans"],
    ["team", "Team checkout", "/team"],
    ["solo", "Solo checkout", "/solo"],
    ["done", "Done", "/done"],
  ].map(([id, title, route]) => ({ id, title, route, sourceFile: `${id}.tsx`, kind: "page", stateKey: "default", confidence: 1, persona: "default", diagnostics: [], interactiveTargets: [], evidence: [{ kind: "static", detail: "page" }] })),
  edges: [
    ["home-choose", "home", "choose"],
    ["choose-team", "choose", "team"],
    ["choose-solo", "choose", "solo"],
    ["team-done", "team", "done"],
    ["solo-done", "solo", "done"],
  ].map(([id, source, target]) => ({ id, source, target, action: "Follow link", confidence: 1, observations: [{ id: `observation:${id}`, observedAt, fromUrl: `https://example.com/${source}`, toUrl: `https://example.com/${target}`, durationMs: 10, trigger: { kind: "click", role: "link", name: "Continue" } }], evidence: [{ kind: "observed", detail: "clicked" }] })),
  journeys: [],
  gaps: [],
});

test("composes complete branch paths from observed transition receipts", () => {
  const journeys = composeObservedJourneys(graph.nodes, graph.edges, "default");
  assert.deepEqual(journeys.map((journey) => journey.nodeIds), [
    ["home", "choose", "solo", "done"],
    ["home", "choose", "team", "done"],
  ]);
  assert.equal(journeys.every((journey) => journey.provenance === "composed-from-observed"), true);
  assert.equal(journeys.every((journey) => journey.edgeIds?.length === journey.nodeIds.length - 1), true);
  assert.deepEqual(journeys.map((journey) => journey.title), [
    "Home → Done via Solo checkout",
    "Home → Done via Team checkout",
  ]);
});

test("bounds cyclic journey composition without overflowing the JavaScript stack", () => {
  const nodeCount = 15_000;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    title: `Screen ${index}`,
    route: index === 0 ? "/" : `/screen-${index}`,
    sourceFile: `screen-${index}.tsx`,
    kind: "page" as const,
    stateKey: "default" as const,
    confidence: 1,
    persona: "default",
    diagnostics: [],
    interactiveTargets: [],
    evidence: [{ kind: "static" as const, detail: "page" }],
  }));
  const edges = Array.from({ length: nodeCount }, (_, index) => {
    const targetIndex = (index + 1) % nodeCount;
    return {
      id: `edge-${index}`,
      source: `node-${index}`,
      target: `node-${targetIndex}`,
      action: "Continue",
      confidence: 1,
      observations: [{
        id: `observation-${index}`,
        observedAt,
        fromUrl: `https://example.com/screen-${index}`,
        toUrl: `https://example.com/screen-${targetIndex}`,
        durationMs: 10,
        trigger: { kind: "click" as const, role: "button" as const, name: "Continue" },
      }],
      evidence: [{ kind: "observed" as const, detail: "clicked" }],
    };
  });

  const journeys = composeObservedJourneys(nodes, edges, "default");
  assert.ok(journeys.length > 0 && journeys.length <= 12);
  assert.equal(journeys.every((journey) => journey.nodeIds.length <= 12), true);
  assert.equal(journeys.every((journey) => new Set(journey.nodeIds).size === journey.nodeIds.length), true);
});
