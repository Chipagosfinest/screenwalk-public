import { flowGraphSchema, type Evidence, type FlowGraph, type IdentityPolicy, type ScreenNode, type TransitionEdge } from "@screenbranch/schema";
import { canonicalPath } from "./routes.js";
import { defaultIdentityPolicy, pathnameOf, semanticUrlState } from "./identity.js";

const DYNAMIC_SEGMENT = /^\[[^.[\]]+\]$/;
const CATCH_ALL_SEGMENT = /^\[\.\.\.[^\]]+\]$/;
const OPTIONAL_CATCH_ALL_SEGMENT = /^\[\[\.\.\.[^\]]+\]\]$/;

export function routeTemplateMatches(template: string, concretePath: string): boolean {
  const templateSegments = segments(template);
  const concreteSegments = segments(concretePath);

  const visit = (templateIndex: number, concreteIndex: number): boolean => {
    if (templateIndex === templateSegments.length) return concreteIndex === concreteSegments.length;
    const segment = templateSegments[templateIndex];
    if (!segment) return false;
    if (OPTIONAL_CATCH_ALL_SEGMENT.test(segment)) {
      return visit(templateIndex + 1, concreteIndex) || concreteIndex < concreteSegments.length;
    }
    if (CATCH_ALL_SEGMENT.test(segment)) return concreteIndex < concreteSegments.length;
    if (concreteIndex >= concreteSegments.length) return false;
    if (DYNAMIC_SEGMENT.test(segment)) return visit(templateIndex + 1, concreteIndex + 1);
    return segment === concreteSegments[concreteIndex] && visit(templateIndex + 1, concreteIndex + 1);
  };

  return visit(0, 0);
}

export function matchingRouteTemplate(templates: Iterable<string>, concretePath: string): string | undefined {
  return [...templates]
    .filter((template) => template.includes("[") && routeTemplateMatches(template, concretePath))
    .sort((left, right) => staticSegmentCount(right) - staticSegmentCount(left) || right.length - left.length)[0];
}

export function collapseDynamicRouteInstances(input: FlowGraph, policy: IdentityPolicy = defaultIdentityPolicy): FlowGraph {
  const templates = input.nodes.filter((node) => node.route.includes("[") && node.stateKey === "default");
  if (templates.length === 0) return input;

  const replacementById = new Map<string, ScreenNode>();
  const instancesByTemplate = new Map<string, ScreenNode[]>();
  for (const node of input.nodes) {
    if (node.sourceFile !== "(browser discovery)" || node.stateKey !== "default") continue;
    const semanticState = semanticUrlState(node.route, policy);
    if (Object.keys(semanticState.query).length > 0 || semanticState.hash) continue;
    const eligibleTemplates = templates.filter((template) => template.persona === node.persona).map((template) => template.route);
    const templateRoute = matchingRouteTemplate(eligibleTemplates, node.route);
    const template = templates.find((candidate) => candidate.persona === node.persona && candidate.route === templateRoute);
    if (!template) continue;
    replacementById.set(node.id, template);
    instancesByTemplate.set(template.id, [...(instancesByTemplate.get(template.id) ?? []), node]);
  }
  if (replacementById.size === 0) return input;

  const nodes = input.nodes
    .filter((node) => !replacementById.has(node.id))
    .map((node) => mergeTemplateEvidence(node, instancesByTemplate.get(node.id) ?? []));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeIdMap = new Map<string, string | undefined>();
  const edgeRecords: Array<{ edge: TransitionEdge; collapsed: boolean }> = [];

  for (const original of input.edges) {
    const source = replacementById.get(original.source)?.id ?? original.source;
    const target = replacementById.get(original.target)?.id ?? original.target;
    const collapsed = source !== original.source || target !== original.target;
    if (source === target) {
      edgeIdMap.set(original.id, undefined);
      continue;
    }
    const existing = edgeRecords.find((record) => record.edge.source === source && record.edge.target === target && (record.collapsed || collapsed));
    if (existing) {
      existing.edge = mergeEdges(existing.edge, original, collapsed ? nodeById.get(target) : undefined);
      existing.collapsed = existing.collapsed || collapsed;
      edgeIdMap.set(original.id, existing.edge.id);
      continue;
    }
    const edge = {
      ...original,
      id: collapsed ? `edge:observed:${source}:${target}:route-family` : original.id,
      source,
      target,
      action: collapsed ? `Open ${nodeById.get(target)?.title ?? "screen"}` : original.action,
    };
    edgeRecords.push({ edge, collapsed });
    edgeIdMap.set(original.id, edge.id);
  }

  const edges = edgeRecords.map((record) => record.edge);
  const edgeByPair = new Map(edges.map((edge) => [`${edge.source}->${edge.target}`, edge]));
  const journeys = input.journeys.map((journey) => {
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    journey.nodeIds.forEach((nodeId, index) => {
      const mappedNodeId = replacementById.get(nodeId)?.id ?? nodeId;
      if (nodeIds.at(-1) === mappedNodeId) return;
      if (nodeIds.length > 0) {
        const originalEdgeId = journey.edgeIds?.[index - 1];
        const mappedEdgeId = originalEdgeId ? edgeIdMap.get(originalEdgeId) : undefined;
        const fallbackEdge = edgeByPair.get(`${nodeIds.at(-1)}->${mappedNodeId}`);
        if (mappedEdgeId ?? fallbackEdge?.id) edgeIds.push(mappedEdgeId ?? fallbackEdge!.id);
      }
      nodeIds.push(mappedNodeId);
    });
    const first = nodeById.get(nodeIds[0] ?? "");
    const last = nodeById.get(nodeIds.at(-1) ?? "");
    const title = nodeIds.length <= 1 ? first?.title ?? journey.title : `${first?.title ?? "Start"} → ${last?.title ?? "Screen"}`;
    return { ...journey, title, nodeIds, edgeIds: edgeIds.length === Math.max(0, nodeIds.length - 1) ? edgeIds : undefined };
  });
  const uniqueJourneys = [...new Map(journeys.map((journey) => [journey.nodeIds.join("->"), journey])).values()];

  return flowGraphSchema.parse({ ...input, nodes, edges, journeys: uniqueJourneys });
}

function mergeTemplateEvidence(template: ScreenNode, instances: ScreenNode[]): ScreenNode {
  if (instances.length === 0) return template;
  const representative = [...instances].sort((left, right) => captureScore(right) - captureScore(left))[0];
  if (!representative) return template;
  const evidence: Evidence[] = uniqueEvidence([
    ...template.evidence,
    ...representative.evidence,
    { kind: "inferred", detail: `${instances.length} concrete URL${instances.length === 1 ? "" : "s"} matched the ${template.route} route template and are represented as content variants of this screen.` },
  ]);
  return {
    ...template,
    confidence: Math.max(template.confidence, representative.confidence),
    capture: template.capture ?? representative.capture,
    captureVariants: { ...representative.captureVariants, ...template.captureVariants },
    diagnostics: template.diagnostics.length > 0 ? template.diagnostics : representative.diagnostics,
    interactiveTargets: template.interactiveTargets.length > 0 ? template.interactiveTargets : representative.interactiveTargets,
    evidence,
  };
}

function mergeEdges(existing: TransitionEdge, incoming: TransitionEdge, collapsedTarget?: ScreenNode): TransitionEdge {
  const observations = [...(existing.observations ?? []), ...(incoming.observations ?? [])];
  return {
    ...existing,
    action: collapsedTarget ? `Open ${collapsedTarget.title}` : existing.action,
    confidence: Math.max(existing.confidence, incoming.confidence),
    observations: observations.length > 0 ? [...new Map(observations.map((observation) => [observation.id, observation])).values()].slice(-5) : undefined,
    evidence: uniqueEvidence([...existing.evidence, ...incoming.evidence]),
  };
}

function uniqueEvidence(evidence: Evidence[]): Evidence[] {
  return [...new Map(evidence.map((item) => [`${item.kind}:${item.detail}:${item.sourceFile ?? ""}:${item.line ?? ""}`, item])).values()];
}

function captureScore(node: ScreenNode): number {
  return (node.capture?.quality === "ready" ? 4 : node.capture ? 2 : 0)
    + (node.captureVariants?.desktop ? 2 : 0)
    + (node.captureVariants?.mobile ? 1 : 0);
}

function segments(route: string): string[] {
  return canonicalPath(pathnameOf(route)).split("/").filter(Boolean);
}

function staticSegmentCount(route: string): number {
  return segments(route).filter((segment) => !segment.includes("[")).length;
}
