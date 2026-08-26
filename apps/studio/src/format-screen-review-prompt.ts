import type { FlowGraph } from "@screenbranch/schema";

export type HandoffReviewStatus = "in-flow" | "out-of-flow" | "needs-review";
export type HandoffScreenReview = { status?: HandoffReviewStatus; note?: string; acceptanceCriteria?: string };
export type HandoffRecommendation = {
  evidenceClass: string;
  action: string;
  reasons: string[];
};

export function edgeActionLabel(action: string, targetTitle?: string): string {
  const concise = action.replace(/^(Follow link|Navigate) to /, "").replace(/^Click\s+/, "").replace(/\s+/g, " ").trim();
  if (concise.length <= 42) return concise;
  const destination = targetTitle?.replace(/\s+/g, " ").trim() || "next screen";
  return `Open ${destination.length > 34 ? `${destination.slice(0, 33).trim()}…` : destination}`;
}

function reviewStatusLabel(status?: HandoffReviewStatus): string {
  if (status === "in-flow") return "keep in the selected path";
  if (status === "out-of-flow") return "review as part of another path";
  if (status === "needs-review") return "needs a closer look";
  return "not classified";
}

function presentationLabel(node: FlowGraph["nodes"][number]): string {
  const presentation = node.identity?.presentation;
  if (!presentation || presentation.kind === "page") return "page";
  return `${presentation.kind}${presentation.overlays.length > 0 ? ` · ${presentation.overlays.join(", ")}` : ""}`;
}

export function evidenceKindsForHandoff(node: FlowGraph["nodes"][number]): string {
  const kinds = new Set<string>();
  for (const item of node.evidence) kinds.add(item.kind === "static" ? "found in code" : item.kind === "observed" ? "followed in browser" : item.kind);
  if (node.capture?.kind) kinds.add(node.capture.kind === "captured" ? "screenshot saved" : node.capture.kind);
  return [...kinds].join(" / ") || "none";
}

export function formatScreenReviewPrompt(
  graph: Pick<FlowGraph, "project" | "nodes">,
  node: FlowGraph["nodes"][number],
  review: HandoffScreenReview | undefined,
  recommendation: HandoffRecommendation | undefined,
  journey: { title: string } | undefined,
  conditionLabel: string,
  incoming: FlowGraph["edges"],
  outgoing: FlowGraph["edges"],
): string {
  const nodeById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const formatEdge = (edge: FlowGraph["edges"][number], direction: "in" | "out") => {
    const other = nodeById.get(direction === "in" ? edge.source : edge.target);
    return `${edgeActionLabel(edge.action, direction === "out" ? other?.title : node.title)} ${direction === "in" ? "from" : "to"} ${other?.title ?? other?.route ?? "unknown screen"}`;
  };
  return [
    `Review this Screenwalk UI feedback for ${graph.project.name}.`,
    "Open the route and check how people reach it before editing. Do not delete or hide a screen only because Screenwalk did not find a path to it.",
    "",
    `Screen: ${node.title}`,
    `Route: ${node.route}`,
    `UI state: ${presentationLabel(node)}`,
    `Source: ${node.sourceFile}`,
    `What Screenwalk checked: ${evidenceKindsForHandoff(node)}`,
    `Active path: ${journey?.title ?? "none selected"}`,
    `Experience condition: ${conditionLabel}`,
    `Screenwalk suggestion: ${recommendation ? `${recommendation.evidenceClass} — ${recommendation.action}` : "no suggestion available"}`,
    `Why: ${recommendation?.reasons.join(" ") ?? "none"}`,
    `User decision: ${reviewStatusLabel(review?.status)}`,
    `Requested change: ${review?.note?.trim() || "Inspect the screen and its surrounding path before deciding what should change."}`,
    `Done when: ${review?.acceptanceCriteria?.trim() || "The requested change works on the active path without regressing adjacent screens."}`,
    `Arrived via: ${incoming.length > 0 ? incoming.map((edge) => formatEdge(edge, "in")).join("; ") : "no mapped incoming path"}`,
    `Doors from here: ${outgoing.length > 0 ? outgoing.map((edge) => formatEdge(edge, "out")).join("; ") : "no mapped outgoing path"}`,
    "",
    "Make the smallest defensible change, preserve intentional direct links and sign-in gates, then check the updated desktop and mobile screens again.",
  ].join("\n");
}

export function formatJourneyChangeBrief(
  graph: FlowGraph,
  nodes: FlowGraph["nodes"],
  reviews: Record<string, HandoffScreenReview>,
  context: {
    journey?: FlowGraph["journeys"][number];
    viewport: string;
    persona: string;
    conditionLabel: string;
  },
): string {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const journeyNodeIds = new Set(context.journey?.nodeIds ?? []);
  const journeyEdges = graph.edges.filter((edge) => journeyNodeIds.has(edge.source) && journeyNodeIds.has(edge.target));
  const conditions = journeyEdges.flatMap((edge) => edge.conditions ?? []);
  const observedPath = context.journey?.nodeIds.map((id) => nodeById.get(id)?.title ?? id).join(" → ") ?? "No path selected";
  const selected = nodes.length > 0 ? nodes : context.journey?.nodeIds.flatMap((id) => nodeById.get(id) ?? []) ?? [];

  return [
    `# Change brief: ${graph.project.name}`,
    "",
    `Flow: ${context.journey?.title ?? "Selected screens"}`,
    `Observed path: ${observedPath}`,
    `Review context: ${context.viewport} · ${context.persona} · ${context.conditionLabel}`,
    `Active conditions: ${conditions.length > 0 ? conditions.map((condition) => `${condition.label}${condition.value === undefined ? "" : ` (${String(condition.value)})`}`).join("; ") : "none recorded"}`,
    `Baseline captured: ${graph.project.generatedAt}`,
    "",
    "## Requested changes",
    "",
    ...selected.flatMap((node, index) => {
      const review = reviews[node.id];
      return [
        `### ${index + 1}. ${node.title}`,
        `- Route: ${node.route}`,
        `- UI state: ${presentationLabel(node)}`,
        `- Source: ${node.sourceFile}`,
        `- Observed: ${node.capture?.quality === "ready" ? "yes, Screenwalk opened this screen" : "no, found in code only"}`,
        `- Change: ${review?.note?.trim() || "Inspect this screen in the flow and make only a defensible change."}`,
        `- Done when: ${review?.acceptanceCriteria?.trim() || "The intended behavior is visible on this screen and adjacent path behavior is preserved."}`,
        "",
      ];
    }),
    "## Implementation boundary",
    "",
    "Use the routes and source files above as starting points, but inspect the live path before editing. Preserve intentional sign-in gates, direct links, alternate conditions, and unrelated screens. Do not remove a screen only because it was not observed.",
    "",
    "## Re-run check",
    "",
    "After editing, rerun the same Screenwalk journey under the same viewport, access context, and conditions. Check every `Done when` criterion, report anything still present or changed elsewhere, and keep the resulting journey receipt with the next review round.",
  ].join("\n");
}
