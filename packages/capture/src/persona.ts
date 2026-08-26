import { flowGraphSchema, type FlowGraph } from "@screenbranch/schema";

export function ensurePersonaGraph(input: FlowGraph, persona: string, label: string): FlowGraph {
  if (persona === "default") return input;

  const baseNodes = input.nodes.filter((node) => node.persona === "default");
  const nodeIdByBaseId = new Map(baseNodes.map((node) => [node.id, personaNodeId(node.id, persona)]));
  const existingNodeIds = new Set(input.nodes.map((node) => node.id));
  const personaNodes = baseNodes.flatMap((node) => {
    const id = nodeIdByBaseId.get(node.id);
    if (!id || existingNodeIds.has(id)) return [];
    return [{
      ...node,
      id,
      persona,
      capture: undefined,
      captureVariants: undefined,
      diagnostics: [],
      interactiveTargets: [],
      evidence: [
        ...node.evidence.filter((item) => item.kind !== "observed"),
        { kind: "declared" as const, detail: `Access persona: ${label}` },
      ],
    }];
  });

  const existingEdgeIds = new Set(input.edges.map((edge) => edge.id));
  const personaEdges = input.edges.flatMap((edge) => {
    const source = nodeIdByBaseId.get(edge.source);
    const target = nodeIdByBaseId.get(edge.target);
    if (!source || !target || !edge.evidence.some((item) => item.kind === "static" || item.kind === "declared")) return [];
    const id = `${edge.id}:persona:${persona}`;
    if (existingEdgeIds.has(id)) return [];
    return [{
      ...edge,
      id,
      source,
      target,
      confidence: Math.min(edge.confidence, 0.92),
      observations: undefined,
      evidence: edge.evidence.filter((item) => item.kind !== "observed"),
    }];
  });

  const existingJourneyIds = new Set(input.journeys.map((journey) => journey.id));
  const personaJourneys = input.journeys.flatMap((journey) => {
    if (journey.kind === "observed") return [];
    const nodeIds = journey.nodeIds.map((nodeId) => nodeIdByBaseId.get(nodeId)).filter((nodeId): nodeId is string => Boolean(nodeId));
    if (nodeIds.length !== journey.nodeIds.length) return [];
    const id = `${journey.id}:persona:${persona}`;
    if (existingJourneyIds.has(id)) return [];
    return [{ ...journey, id, nodeIds, edgeIds: undefined }];
  });

  return flowGraphSchema.parse({
    ...input,
    nodes: [...input.nodes, ...personaNodes],
    edges: [...input.edges, ...personaEdges],
    journeys: [...input.journeys, ...personaJourneys],
  });
}

export function personaNodeId(nodeId: string, persona: string): string {
  return `${nodeId}:persona:${persona}`;
}
