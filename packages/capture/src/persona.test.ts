import assert from "node:assert/strict";
import test from "node:test";
import { flowGraphSchema, setupRecipeSchema } from "@screenbranch/schema";
import { ensurePersonaGraph } from "./persona.ts";

test("adds an isolated persona graph without copying observations or captures", () => {
  const source = flowGraphSchema.parse({
    schemaVersion: "screenbranch.graph.v0",
    project: { name: "fixture", root: "/tmp/fixture", framework: "web", generatedAt: "2026-08-15T00:00:00.000Z" },
    nodes: [
      { id: "screen:root", title: "Home", route: "/", sourceFile: "app/page.tsx", kind: "page", stateKey: "default", confidence: 1, persona: "default", diagnostics: [], interactiveTargets: [], evidence: [{ kind: "static", detail: "page" }] },
      { id: "screen:account", title: "Account", route: "/account", sourceFile: "app/account/page.tsx", kind: "page", stateKey: "default", confidence: 1, persona: "default", diagnostics: [], interactiveTargets: [], evidence: [{ kind: "static", detail: "page" }] },
    ],
    edges: [{ id: "edge:account", source: "screen:root", target: "screen:account", action: "Open account", confidence: 1, observations: [{ id: "observation:1", observedAt: "2026-08-15T00:00:00.000Z", fromUrl: "https://example.com/", toUrl: "https://example.com/account", durationMs: 10, trigger: { kind: "click", role: "link", name: "Account" } }], evidence: [{ kind: "static", detail: "href=/account" }, { kind: "observed", detail: "clicked" }] }],
    journeys: [],
    gaps: [],
  });

  const result = ensurePersonaGraph(source, "member", "Member");
  const memberNodes = result.nodes.filter((node) => node.persona === "member");
  const memberEdge = result.edges.find((edge) => edge.id === "edge:account:persona:member");
  assert.equal(memberNodes.length, 2);
  assert.equal(memberNodes.every((node) => !node.capture), true);
  assert.deepEqual(memberEdge?.observations, undefined);
  assert.deepEqual(memberEdge?.evidence, [{ kind: "static", detail: "href=/account" }]);
});

test("setup recipes reference environment variables and reject literal credentials", () => {
  const safeRecipe = {
    schemaVersion: "screenbranch.setup.v0",
    persona: "preview",
    label: "Preview access",
    startRoute: "/access",
    actions: [{
      type: "fill",
      locator: { kind: "label", name: "Password" },
      valueFromEnv: "SCREENWALK_PREVIEW_PASSWORD",
    }],
  };
  assert.equal(setupRecipeSchema.safeParse(safeRecipe).success, true);
  assert.equal(setupRecipeSchema.safeParse({
    ...safeRecipe,
    actions: [{ type: "fill", locator: { kind: "label", name: "Password" }, value: "do-not-store-this" }],
  }).success, false);
});
