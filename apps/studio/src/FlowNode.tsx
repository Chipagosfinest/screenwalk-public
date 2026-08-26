import { memo } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import type { ScreenNode } from "@screenbranch/schema";

export type FlowNodeData = ScreenNode & {
  selectedJourney: boolean;
  isEntry: boolean;
  isFocus: boolean;
  isCaptureGap: boolean;
  mapGroup: "connected" | "known" | "source-only";
  mapRole: "connected" | "policy" | "reference" | "direct-entry" | "unknown";
  mapGroupReason: string;
  showRouteOnly: boolean;
  isAuditActive: boolean;
  isAuditFinding: boolean;
  isHandoffSelected: boolean;
  isInspected: boolean;
  reviewStatus?: "in-flow" | "out-of-flow" | "needs-review";
  hasReviewNote: boolean;
  isContextMuted: boolean;
  incomingPortIds: string[];
  outgoingPortIds: string[];
  laneLabel?: string;
  experienceStage: string;
  auditLabel: string;
};

export const FlowNode = memo(function FlowNode({ data }: NodeProps) {
  const node = data as unknown as FlowNodeData;
  const viewportZoom = useStore((state) => state.transform[2]);
  const laneLabelScale = 1 / Math.min(viewportZoom, 1);
  const annotationHeading = node.isEntry ? "Start" : mapRoleLabel(node);
  const annotationDetail = node.isAuditActive && node.isAuditFinding
    ? node.auditLabel
    : node.mapGroup !== "connected"
      ? "No way in found"
      : node.stateKey !== "default"
        ? node.stateKey
        : meaningfulLaneLabel(node.laneLabel, node.experienceStage);
  return (
    <article className={`screen-node ${node.showRouteOnly ? "is-route-only" : ""} ${node.selectedJourney ? "is-in-journey" : ""} ${node.isInspected ? "is-inspected" : ""} ${node.isFocus ? "is-flow-focus" : ""} ${node.isCaptureGap ? "is-capture-gap" : ""} ${node.mapGroup === "known" ? "is-map-known" : node.mapGroup === "source-only" ? "is-map-source-only" : ""} ${node.isHandoffSelected ? "is-handoff-selected" : ""} ${node.isContextMuted ? "is-context-muted" : ""} ${node.isAuditActive && node.isAuditFinding ? "is-audit-finding" : ""} ${node.isAuditActive && !node.isAuditFinding ? "is-audit-muted" : ""}`} title={node.mapGroupReason}>
      {node.laneLabel && node.mapGroup !== "connected" && <div className="node-lane-label" style={{ transform: `scale(${laneLabelScale})` }}>{node.laneLabel}</div>}
      {node.incomingPortIds.map((edgeId, index) => (
        <Handle id={edgeId} key={`in:${edgeId}`} type="target" position={Position.Left} style={{ top: portPosition(index, node.incomingPortIds.length) }} />
      ))}
      <div className="node-annotation">
        <span>{node.isInspected ? "Selected" : annotationHeading}</span>
        {annotationDetail && <small>{node.isInspected ? "Details open" : annotationDetail}</small>}
        <i className={node.capture?.quality === "ready" ? "is-observed" : node.capture ? "is-incomplete" : "is-unobserved"}>{node.capture?.quality === "ready" ? "Opened" : node.capture ? "Check" : "In code"}</i>
      </div>
      <div className="screen-preview" aria-hidden="true">
        {node.capture ? (
          <img alt="" decoding="async" draggable={false} loading="lazy" src={node.capture.asset} />
        ) : (
          <div className="uncaptured-state">
            <span>{node.stateKey === "default" ? "Not opened yet" : `${node.stateKey} state`}</span>
            <small>{node.stateKey === "default" ? "Found in code only" : "Found in code · not opened"}</small>
          </div>
        )}
      </div>
      <div className="screen-meta">
        <strong>{node.title}</strong>
        <code>{node.route}</code>
        <small>{node.isHandoffSelected ? "Selected for agent" : node.hasReviewNote ? "Feedback attached" : node.identity?.review.status === "needs-review" ? "Check this grouping" : node.reviewStatus === "in-flow" ? "Kept in path" : node.reviewStatus === "out-of-flow" ? "Marked for another path" : node.reviewStatus === "needs-review" ? "Needs checking" : node.interactiveTargets.length > 0 ? `${node.interactiveTargets.filter((target) => target.status === "observed").length}/${node.interactiveTargets.length} controls tried` : node.capture ? "Screen opened" : "Found in code"}</small>
      </div>
      {node.outgoingPortIds.map((edgeId, index) => (
        <Handle id={edgeId} key={`out:${edgeId}`} type="source" position={Position.Right} style={{ top: portPosition(index, node.outgoingPortIds.length) }} />
      ))}
    </article>
  );
});

function portPosition(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `${28 + (index * 44) / (count - 1)}%`;
}

function meaningfulLaneLabel(laneLabel: string | undefined, experienceStage: string): string | undefined {
  if (!laneLabel || laneLabel.toLowerCase() === "screen" || laneLabel.toLowerCase() === experienceStage.toLowerCase()) return undefined;
  return laneLabel;
}

function mapRoleLabel(node: FlowNodeData): string {
  if (node.mapGroup === "connected") return node.experienceStage;
  if (node.mapGroup === "source-only") return "Not reached yet";
  if (node.mapRole === "policy") return "Likely policy";
  if (node.mapRole === "reference") return "Likely help screen";
  if (node.mapGroup === "known") return "Other entry";
  return "Not reached yet";
}
