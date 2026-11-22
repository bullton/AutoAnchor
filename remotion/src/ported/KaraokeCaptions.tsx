import React from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { useStyle } from "../components/StyleContext";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export const KaraokeCaptions: React.FC<{
  photo: string;
  text: string;
  speaker: string;
  start?: number;
  end?: number;
}> = ({ photo, text, speaker, start = 16, end = 130 }) => {
  const frame = useCurrentFrame();
  const { palette } = useStyle();
  const chars = Array.from(text);
  const step = (end - start) / Math.max(1, chars.length);
  const head = clamp((frame - start) / Math.max(1, end - start));
  const inO = interpolate(frame, [4, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: palette.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile(photo)})`,
          backgroundSize: "cover",
          backgroundPosition: "center 34%",
          transform: `scale(${interpolate(frame, [0, 150], [1.03, 1.09])})`,
          filter: "saturate(0.7)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${palette.bg}D9 0%, ${palette.bg}8C 32%, ${palette.bg}E6 58%, ${palette.bg} 88%)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 66,
          top: 84,
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: inO,
        }}
      >
        <div
          style={{
            padding: "10px 18px",
            borderRadius: 999,
            border: `1.5px solid ${palette.accent}88`,
            color: palette.accent,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 4,
          }}
        >
          字幕 · 逐字高亮
        </div>
        <div style={{ fontSize: 21, color: palette.inkDim, letterSpacing: 3 }}>{speaker}</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          top: 980,
          opacity: inO,
          transform: `translateY(${interpolate(inO, [0, 1], [36, 0])}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "18px 6px",
            padding: "44px 34px",
            borderRadius: 26,
            background: `${palette.bg}B3`,
            border: `1.5px solid ${palette.line}`,
            backdropFilter: "blur(6px)",
            boxShadow: "0 30px 80px #0007",
          }}
        >
          {chars.map((ch, i) => {
            const p = clamp((frame - start - i * step) / Math.max(1, step * 0.9));
            return (
              <span
                key={`${ch}-${i}`}
                style={{
                  fontSize: 62,
                  lineHeight: 1.25,
                  fontWeight: 800,
                  letterSpacing: 1,
                  backgroundImage: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accent} ${
                    p * 100
                  }%, ${palette.ink} ${p * 100}%, ${palette.ink} 100%)`,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  transform: p > 0.02 && p < 0.98 ? "translateY(-4px)" : "translateY(0)",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>

        <div style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ fontSize: 19, letterSpacing: 5, color: palette.inkFaint, fontWeight: 700 }}>
            KARAOKE
          </div>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: `${palette.ink}1F` }}>
            <div
              style={{
                width: `${head * 100}%`,
                height: "100%",
                borderRadius: 2,
                background: `linear-gradient(90deg, ${palette.accent}AA, ${palette.accent})`,
                boxShadow: `0 0 20px ${palette.accent}66`,
              }}
            />
          </div>
          <div style={{ fontSize: 19, letterSpacing: 3, color: palette.inkDim, fontWeight: 700 }}>
            {String(Math.round(head * 100)).padStart(2, "0")}%
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
