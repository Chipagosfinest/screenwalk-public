import { forwardRef, useEffect } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { FlowGraph } from "@screenbranch/schema";
import { FlowPlayback } from "./FlowPlayback.tsx";

type JourneyPlayerProps = {
  graph: FlowGraph;
  nodeIds: string[];
  framesPerStep: number;
  onReady?: () => void;
};

const JourneyPlayer = forwardRef<PlayerRef, JourneyPlayerProps>(function JourneyPlayer(
  { graph, nodeIds, framesPerStep, onReady },
  ref,
) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <Player
      ref={ref}
      component={FlowPlayback}
      inputProps={{ graph, nodeIds, framesPerStep }}
      durationInFrames={Math.max(1, nodeIds.length * framesPerStep)}
      compositionWidth={1440}
      compositionHeight={900}
      fps={30}
      controls
      loop
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: "16 / 10" }}
    />
  );
});

export default JourneyPlayer;
