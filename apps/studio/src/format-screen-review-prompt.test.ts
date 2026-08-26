import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { flowGraphSchema } from "@screenbranch/schema";
import { evidenceKindsForHandoff, formatJourneyChangeBrief, formatScreenReviewPrompt } from "./format-screen-review-prompt.ts";

const graph = flowGraphSchema.parse(JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "data/demo-graph.json"),
  "utf8",
)));

test("the public HTML fixture includes ready desktop and mobile captures", () => {
  const home = graph.nodes.find((node) => node.id === "screen:root");
  const plans = graph.nodes.find((node) => node.route === "/plans.html");
  assert.ok(home, "bundled fixture graph must include Home");
  assert.ok(plans, "bundled fixture graph must include Plans");
  assert.equal(home.route, "/");
  assert.equal(home.capture?.quality, "ready");
  assert.equal(home.captureVariants?.desktop?.quality, "ready");
  assert.equal(home.captureVariants?.mobile?.quality, "ready");
  assert.equal(plans.capture?.quality, "ready");
});

test("copy-for-agent prompt from fixture Home includes route, source file, and plain-language checks", () => {
  const home = graph.nodes.find((node) => node.id === "screen:root");
  assert.ok(home);
  const incoming = graph.edges.filter((edge) => edge.target === home.id);
  const outgoing = graph.edges.filter((edge) => edge.source === home.id);
  const prompt = formatScreenReviewPrompt(
    graph,
    home,
    undefined,
    { evidenceClass: "Observed in this path", action: "Keep in Home → Plans", reasons: ["Step 1"] },
    { title: "Home → Plans" },
    "Anyone",
    incoming,
    outgoing,
  );
  assert.equal(prompt.includes(`Route: ${home.route}\n`), true);
  assert.equal(prompt.includes("UI state: page\n"), true);
  assert.equal(prompt.includes(`Source: ${home.sourceFile}\n`), true);
  assert.equal(prompt.includes(`What Screenwalk checked: ${evidenceKindsForHandoff(home)}\n`), true);
  assert.equal(home.evidence.some((item) => item.kind === "static"), true);
  assert.equal(home.evidence.some((item) => item.kind === "observed"), true);
  assert.equal(home.capture?.kind, "captured");
  assert.match(prompt, /found in code/);
  assert.match(prompt, /followed in browser/);
  assert.match(prompt, /screenshot saved/);
  assert.doesNotMatch(prompt, /unconnected is dead/i);
});

test("handoff names an observed overlay state separately from its route", () => {
  const overlay = flowGraphSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node, index) => index === 0 ? {
      ...node,
      id: "screen:drawer",
      title: "Home · Invite teammates",
      kind: "drawer",
      stateKey: "drawer",
      identity: {
        familyId: "family:drawer",
        variantId: "variant:drawer",
        routeTemplate: "/",
        semanticUrlState: { query: {} },
        presentation: { kind: "drawer", overlays: ["drawer:Invite teammates"], slots: [] },
        review: { status: "automatic", reasons: [], suggestions: [] },
      },
    } : node),
    edges: [],
    journeys: [],
  }).nodes[0];
  assert.ok(overlay);
  const prompt = formatScreenReviewPrompt(graph, overlay, undefined, undefined, undefined, "Anyone", [], []);
  assert.match(prompt, /UI state: drawer · drawer:Invite teammates/);
});

test("change brief carries flow context, a unique critique, acceptance criteria, and rerun instructions", () => {
  const journey = graph.journeys[0];
  assert.ok(journey);
  const selected = journey.nodeIds.slice(0, 2).flatMap((id) => graph.nodes.find((node) => node.id === id) ?? []);
  assert.equal(selected.length, 2);
  const brief = formatJourneyChangeBrief(
    graph,
    selected,
    {
      [selected[1]!.id]: {
        note: "Keep the alternate state visible beside the selected path.",
        acceptanceCriteria: "Both conditioned outcomes remain readable at 390px.",
      },
    },
    { journey, viewport: "mobile", persona: "default", conditionLabel: "Anyone" },
  );
  assert.match(brief, /^# Change brief:/);
  assert.match(brief, /Observed path:/);
  assert.match(brief, /Keep the alternate state visible beside the selected path\./);
  assert.match(brief, /Done when: Both conditioned outcomes remain readable at 390px\./);
  assert.match(brief, /rerun the same Screenwalk journey/i);
  assert.match(brief, /journey receipt/i);
});
