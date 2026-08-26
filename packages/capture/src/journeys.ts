import { createHash } from "node:crypto";
import type { Journey, ScreenNode, TransitionEdge } from "@screenbranch/schema";

const MAX_ENUMERATED_PATHS = 200;
const MAX_JOURNEYS = 12;
const MAX_STATES = 12;

export function composeObservedJourneys(
  nodes: ScreenNode[],
  edges: TransitionEdge[],
  persona: string,
): Journey[] {
  const eligibleNodes = nodes.filter((node) => node.persona === persona && node.stateKey === "default");
  const nodeById = new Map(eligibleNodes.map((node) => [node.id, node]));
  const observedEdges = dedupeObservedEdges(edges.filter((edge) =>
    nodeById.has(edge.source) && nodeById.has(edge.target) && (edge.observations?.length ?? 0) > 0
  ));
  if (observedEdges.length === 0) return [];

  const outgoing = new Map<string, TransitionEdge[]>();
  const incoming = new Set<string>();
  for (const edge of observedEdges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.add(edge.target);
  }
  for (const list of outgoing.values()) list.sort((left, right) => left.target.localeCompare(right.target));

  const entry = eligibleNodes.find((node) => node.route === "/");
  const roots = [
    ...(entry ? [entry] : []),
    ...eligibleNodes.filter((node) => node.id !== entry?.id && outgoing.has(node.id) && !incoming.has(node.id)),
  ];
  const paths: Array<{ nodeIds: string[]; edgeIds: string[] }> = [];
  const covered = new Set<string>();

  const visit = (nodeId: string, nodeIds: string[], edgeIds: string[]) => {
    if (paths.length >= MAX_ENUMERATED_PATHS) return;
    const nextNodeIds = [...nodeIds, nodeId];
    nextNodeIds.forEach((id) => covered.add(id));
    if (nextNodeIds.length > 1) paths.push({ nodeIds: nextNodeIds, edgeIds });
    const nextEdges = (outgoing.get(nodeId) ?? []).filter((edge) => !nextNodeIds.includes(edge.target));
    if (nextEdges.length === 0 || nextNodeIds.length >= MAX_STATES) return;
    for (const edge of nextEdges) visit(edge.target, nextNodeIds, [...edgeIds, edge.id]);
  };

  for (const root of roots) visit(root.id, [], []);
  for (const node of eligibleNodes) {
    if (paths.length >= MAX_ENUMERATED_PATHS) break;
    if (!covered.has(node.id) && outgoing.has(node.id)) visit(node.id, [], []);
  }

  const uniquePaths = [...new Map(paths.map((path) => [path.nodeIds.join("->"), path])).values()];
  const cyclic = hasDirectedCycle(eligibleNodes.map((node) => node.id), outgoing);
  const candidates = cyclic
    ? uniquePaths
    : uniquePaths.filter((path) => (outgoing.get(path.nodeIds.at(-1) ?? "") ?? []).length === 0);
  const representativePaths = representativeObservedPaths(candidates, entry?.id, cyclic ? 1 : 2).slice(0, MAX_JOURNEYS);
  const endpointCounts = representativePaths.reduce((counts, path) => {
    const key = endpointKey(path);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return representativePaths.map((path) => {
    const first = nodeById.get(path.nodeIds[0] ?? "");
    const last = nodeById.get(path.nodeIds.at(-1) ?? "");
    const branch = endpointCounts.get(endpointKey(path)) && endpointCounts.get(endpointKey(path))! > 1
      ? nodeById.get(path.nodeIds.at(-2) ?? "")
      : undefined;
    return {
      id: `journey:auto:${shortHash(path.nodeIds.join(":"))}`,
      title: `${first?.title ?? "Start"} → ${last?.title ?? "Outcome"}${branch ? ` via ${branch.title}` : ""}`,
      kind: "observed",
      provenance: "composed-from-observed",
      nodeIds: path.nodeIds,
      edgeIds: path.edgeIds,
    };
  });
}

function representativeObservedPaths(paths: Array<{ nodeIds: string[]; edgeIds: string[] }>, entryNodeId: string | undefined, pathsPerEndpoint: number): Array<{ nodeIds: string[]; edgeIds: string[] }> {
  const groups = new Map<string, Array<{ nodeIds: string[]; edgeIds: string[] }>>();
  for (const path of paths) groups.set(endpointKey(path), [...(groups.get(endpointKey(path)) ?? []), path]);
  return [...groups.values()]
    .flatMap((group) => group
      .sort((left, right) => left.nodeIds.length - right.nodeIds.length || left.nodeIds.join(":").localeCompare(right.nodeIds.join(":")))
      .slice(0, pathsPerEndpoint))
    .sort((left, right) => {
      const leftStartsAtEntry = left.nodeIds[0] === entryNodeId ? 0 : 1;
      const rightStartsAtEntry = right.nodeIds[0] === entryNodeId ? 0 : 1;
      return leftStartsAtEntry - rightStartsAtEntry || left.nodeIds.length - right.nodeIds.length || left.nodeIds.join(":").localeCompare(right.nodeIds.join(":"));
    });
}

function hasDirectedCycle(nodeIds: string[], outgoing: Map<string, TransitionEdge[]>): boolean {
  const active = new Set<string>();
  const complete = new Set<string>();
  for (const startNodeId of nodeIds) {
    if (complete.has(startNodeId)) continue;
    const stack: Array<{ nodeId: string; edgeIndex: number }> = [{ nodeId: startNodeId, edgeIndex: 0 }];
    active.add(startNodeId);
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (!frame) break;
      const edges = outgoing.get(frame.nodeId) ?? [];
      const edge = edges[frame.edgeIndex];
      if (!edge) {
        active.delete(frame.nodeId);
        complete.add(frame.nodeId);
        stack.pop();
        continue;
      }
      frame.edgeIndex += 1;
      if (active.has(edge.target)) return true;
      if (complete.has(edge.target)) continue;
      active.add(edge.target);
      stack.push({ nodeId: edge.target, edgeIndex: 0 });
    }
  }
  return false;
}

function endpointKey(path: { nodeIds: string[] }): string {
  return `${path.nodeIds[0] ?? ""}->${path.nodeIds.at(-1) ?? ""}`;
}

function dedupeObservedEdges(edges: TransitionEdge[]): TransitionEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
