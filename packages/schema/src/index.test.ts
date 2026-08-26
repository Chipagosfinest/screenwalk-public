import assert from "node:assert/strict";
import test from "node:test";
import { flowComparisonSchema, flowGraphSchema, identityPolicySchema, journeyRecipeSchema, journeyRunReceiptSchema } from "./index.ts";

const observedAt = "2026-08-17T00:00:00.000Z";
const node = (id: string, route: string) => ({
  id,
  title: id,
  route,
  sourceFile: `${id}.tsx`,
  kind: "page" as const,
  stateKey: "default" as const,
  confidence: 1,
  persona: "default",
  diagnostics: [],
  interactiveTargets: [],
  evidence: [{ kind: "static" as const, detail: "page" }],
});
const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  action: "Continue",
  confidence: 1,
  observations: [{
    id: `observation:${id}`,
    observedAt,
    fromUrl: `https://example.com/${source}`,
    toUrl: `https://example.com/${target}`,
    durationMs: 10,
    trigger: { kind: "click" as const, role: "button" as const, name: "Continue" },
  }],
  evidence: [{ kind: "observed" as const, detail: "clicked" }],
});

const validGraph = {
  schemaVersion: "screenbranch.graph.v0" as const,
  project: { name: "fixture", root: "/tmp/fixture", framework: "web" as const, generatedAt: observedAt },
  nodes: [node("home", "/"), node("done", "/done")],
  edges: [edge("home-done", "home", "done")],
  journeys: [{ id: "journey", title: "Home to done", nodeIds: ["home", "done"], edgeIds: ["home-done"] }],
  gaps: [],
};

test("accepts a graph whose transition and journey references agree", () => {
  assert.equal(flowGraphSchema.safeParse(validGraph).success, true);
});

test("accepts graph-owned immutable revision and deployment evidence", () => {
  assert.equal(flowGraphSchema.safeParse({
    ...validGraph,
    run: {
      id: "run-1",
      startedAt: observedAt,
      completedAt: observedAt,
      baseUrl: "https://product.example.com",
      environment: "production",
      status: "complete",
      revision: { sha: "7768e79f1", branch: "main", dirty: false },
      deployment: { id: "deployment-1", url: "https://product.example.com" },
    },
  }).success, true);
});

test("rejects duplicate screen identities and dangling transition endpoints", () => {
  const result = flowGraphSchema.safeParse({
    ...validGraph,
    nodes: [node("home", "/"), node("home", "/duplicate")],
    edges: [edge("home-missing", "home", "missing")],
    journeys: [],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.error.message, /Duplicate screen id: home/);
  assert.match(result.error.message, /Unknown target screen: missing/);
});

test("rejects a journey whose named transition does not connect adjacent screens", () => {
  const result = flowGraphSchema.safeParse({
    ...validGraph,
    nodes: [...validGraph.nodes, node("other", "/other")],
    edges: [edge("home-other", "home", "other")],
    journeys: [{ id: "journey", title: "Broken", nodeIds: ["home", "done"], edgeIds: ["home-other"] }],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.error.message, /does not connect the adjacent journey screens/);
});

test("accepts a source-only comparison when both git revisions are immutable", () => {
  const result = flowComparisonSchema.safeParse({
    schemaVersion: "screenwalk.comparison.v0",
    project: { name: "fixture" },
    reference: { label: "Production reference", environment: "production", git: { sha: "7768e79f1", branch: "main", dirty: false }, capturedAt: observedAt, evidence: "source" },
    candidate: { label: "Staging candidate", environment: "staging", git: { sha: "ecd6c6ad5", branch: "staging", dirty: false }, capturedAt: observedAt, evidence: "source" },
    surfaces: [{
      id: "web",
      label: "Web",
      summary: { referenceScreens: 2, candidateScreens: 2, sharedScreens: 1, onlyReference: 1, onlyCandidate: 1, removedPaths: 1, addedPaths: 1 },
      sharedRoutes: ["/"],
      changes: [
        { id: "old", route: "/old", title: "Old", status: "only-reference" },
        { id: "new", route: "/new", title: "New", status: "only-candidate" },
      ],
    }],
  });
  assert.equal(result.success, true);
});

test("rejects a comparison whose revision identity is mutable or missing", () => {
  const result = flowComparisonSchema.safeParse({
    schemaVersion: "screenwalk.comparison.v0",
    project: { name: "fixture" },
    reference: { label: "Latest", environment: "production", git: { sha: "main", branch: "main", dirty: false }, capturedAt: observedAt, evidence: "source" },
    candidate: { label: "Candidate", environment: "staging", git: { sha: "staging", branch: "staging", dirty: false }, capturedAt: observedAt, evidence: "source" },
    surfaces: [],
  });
  assert.equal(result.success, false);
});

test("rejects runtime comparison identity without deployment evidence", () => {
  const result = flowComparisonSchema.safeParse({
    schemaVersion: "screenwalk.comparison.v0",
    project: { name: "fixture" },
    reference: { label: "Production", environment: "production", git: { sha: "7768e79f1", branch: "main", dirty: false }, capturedAt: observedAt, evidence: "runtime" },
    candidate: { label: "Staging", environment: "staging", git: { sha: "ecd6c6ad5", branch: "staging", dirty: false }, capturedAt: observedAt, evidence: "runtime" },
    surfaces: [{ id: "web", label: "Web", summary: { referenceScreens: 1, candidateScreens: 1, sharedScreens: 1, onlyReference: 0, onlyCandidate: 0, removedPaths: 0, addedPaths: 0, referenceCaptured: 1, candidateCaptured: 1, sharedCaptured: 1 }, sharedRoutes: ["/"], changes: [] }],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.error.message, /Runtime evidence requires a graph-owned deployment URL/);
});

test("accepts a bounded screen identity policy and rejects unknown versions", () => {
  const policy = identityPolicySchema.parse({ schemaVersion: "screenwalk.identity.v0", query: { include: ["tab"] } });
  assert.deepEqual(policy.query, { include: ["tab"], ignore: [] });
  assert.equal(identityPolicySchema.safeParse({ schemaVersion: "screenwalk.identity.v9" }).success, false);
});

test("accepts bounded terminal journey assertions and rejects assertion DSL expansion", () => {
  const recipe = {
    schemaVersion: "screenbranch.recipe.v0",
    journeys: [{
      id: "find-plans",
      title: "Find plans",
      startRoute: "/",
      steps: [{
        targetRoute: "/plans",
        conditions: [{ kind: "feature-flag", label: "new pricing enabled", key: "pricing_v2", value: true, evidence: "declared" }],
        trigger: { role: "link", name: "Plans" },
      }],
      terminalAssertion: { type: "visible-role", role: "heading", name: "Plans" },
    }],
  };
  assert.equal(journeyRecipeSchema.safeParse(recipe).success, true);
  assert.equal(journeyRecipeSchema.safeParse({
    ...recipe,
    journeys: [{ ...recipe.journeys[0], terminalAssertion: { type: "network", url: "/api/plans" } }],
  }).success, false);
});

test("accepts a durable local journey run receipt", () => {
  assert.equal(journeyRunReceiptSchema.safeParse({
    schemaVersion: "screenwalk.journey-run.v0",
    runId: "find-plans-20260825",
    journeyId: "find-plans",
    title: "Find plans",
    recipeHash: "abc123",
    status: "passed",
    startedAt: observedAt,
    completedAt: observedAt,
    persona: "default",
    viewport: "desktop",
    browser: { name: "chromium", version: "140.0" },
    startRoute: "/",
    finalRoute: "/plans",
    nodeIds: ["home", "plans"],
    edgeIds: ["home-plans"],
    asserted: true,
    terminalAssertion: { type: "visible-text", text: "Choose a plan" },
    assertionResult: { passed: true, detail: "Visible text: Choose a plan" },
    diagnosticsCount: 0,
    artifacts: { graph: "/tmp/graph.json", screenshots: ["/tmp/plans.png"], trace: null },
    conditions: [{ kind: "feature-flag", label: "new pricing enabled", key: "pricing_v2", value: true }],
  }).success, true);
});
