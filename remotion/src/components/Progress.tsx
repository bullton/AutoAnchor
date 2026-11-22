import { useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "./StyleContext";

export const Progress = () => {
  const { palette } = useStyle();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: 8,
        background: palette.line,
      }}
    >
      <div
        style={{
          width: `${pct * 100}%`,
          height: "100%",
          background: palette.accent,
        }}
      />
    </div>
  );
};
