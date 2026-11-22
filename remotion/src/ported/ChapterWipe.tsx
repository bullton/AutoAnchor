import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { useStyle } from "../components/StyleContext";

const BARS = 6;

export const ChapterWipe: React.FC<{
  index: string;
  label: string;
  accent?: string;
}> = ({ index, label, accent }) => {
  const frame = useCurrentFrame();
  const { palette } = useStyle();
  const tint = accent || palette.accent;
  const labelIn = interpolate(frame, [1, 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const labelOut = interpolate(frame, [10, 16], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ zIndex: 60, pointerEvents: "none" }}>
      {Array.from({ length: BARS }).map((_, i) => {
        const delay = i * 1.6;
        const y = interpolate(frame, [7 + delay, 27 + delay], [0, -110], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i * 100) / BARS}%`,
              width: `${100 / BARS + 0.12}%`,
              top: 0,
              bottom: 0,
              transform: `translateY(${y}%)`,
              background:
                i % 2 === 0
                  ? palette.bg
                  : `linear-gradient(180deg, ${palette.bgSoft}, ${palette.bg})`,
              borderRight: `1px solid ${palette.line}`,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          opacity: Math.min(labelIn, labelOut),
          transform: `translateY(${interpolate(labelIn, [0, 1], [22, 0])}px)`,
        }}
      >
        <div
          style={{
            fontSize: 104,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -3,
            color: `${palette.ink}18`,
          }}
        >
          {index}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 82 * line, height: 3, background: tint }} />
          <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: 8, color: palette.ink }}>{label}</div>
          <div style={{ width: 82 * line, height: 3, background: tint }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
