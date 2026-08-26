import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { FlowGraph } from "@screenbranch/schema";

interface FlowPlaybackProps {
  graph: FlowGraph;
  nodeIds: string[];
  framesPerStep: number;
}

export function FlowPlayback({ graph, nodeIds, framesPerStep }: FlowPlaybackProps) {
  const frame = useCurrentFrame();
  const rawIndex = Math.floor(frame / framesPerStep);
  const index = Math.min(rawIndex, nodeIds.length - 1);
  const node = graph.nodes.find((candidate) => candidate.id === nodeIds[index]);
  const localFrame = frame - index * framesPerStep;
  const progress = interpolate(localFrame, [0, framesPerStep - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const previous = index > 0 ? graph.nodes.find((candidate) => candidate.id === nodeIds[index - 1]) : undefined;
  const edge = previous && node
    ? graph.edges.find((candidate) => candidate.source === previous.id && candidate.target === node.id)
    : undefined;

  if (!node) return null;

  return (
    <AbsoluteFill className="playback-stage">
      <div className="playback-chrome">
        <span>USER PATH</span>
        <span>{String(index + 1).padStart(2, "0")} / {String(nodeIds.length).padStart(2, "0")}</span>
      </div>
      <div
        className="playback-screen"
        style={{
          opacity: interpolate(progress, [0, 0.12, 1], [0.25, 1, 1]),
          transform: `translateY(${interpolate(progress, [0, 0.18], [20, 0], { extrapolateRight: "clamp" })}px) scale(${interpolate(progress, [0, 0.18], [0.985, 1], { extrapolateRight: "clamp" })})`,
        }}
      >
        <div className="playback-windowbar"><i /><i /><i /><span>{node.capture?.url ?? node.route}</span></div>
        {node.capture ? (
          <img className="playback-capture" decoding="async" src={node.capture.asset} alt={`${node.title} screen`} />
        ) : (
          <div className="playback-uncaptured">
            <p>{edge?.action ?? "Entry state"}</p>
            <h2>{node.title}</h2>
            <strong>Screenwalk has not opened this screen yet.</strong>
          </div>
        )}
      </div>
      <div className="playback-evidence">
        <span>{node.capture ? "Opened" : "Found in code"}</span>
        <code>{node.sourceFile}</code>
        <strong>{node.diagnostics.reduce((total, diagnostic) => total + (diagnostic.count ?? 1), 0)} browser issues</strong>
      </div>
    </AbsoluteFill>
  );
}
