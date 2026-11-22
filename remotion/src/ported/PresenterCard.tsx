import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useStyle } from "../components/StyleContext";

const corner = (pos: React.CSSProperties, color: string): React.CSSProperties => ({
  position: "absolute",
  width: 46,
  height: 46,
  borderColor: color,
  borderStyle: "solid",
  ...pos,
});

export const PresenterCard: React.FC<{
  photo: string;
  name: string;
  role: string;
  headline: string;
  subline: string;
  tag?: string;
}> = ({ photo, name, role, headline, subline, tag = "LIVE" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette } = useStyle();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 16, stiffness: 110 } });
  const cardIn = spring({ frame: frame - 14, fps, config: { damping: 15, stiffness: 95 } });
  const pulse = 0.55 + Math.sin(frame / 9) * 0.35;

  return (
    <AbsoluteFill style={{ background: palette.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("photos/newsroom-live.jpg")})`,
          backgroundSize: "cover",
          backgroundPosition: "center 42%",
          filter: "saturate(0.55) brightness(0.5)",
          transform: `scale(${interpolate(frame, [0, 150], [1.04, 1.1])})`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${palette.bg}E8 0%, ${palette.bg}4D 34%, ${palette.bg}E6 78%, ${palette.bg} 100%)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 66,
          top: 90,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: enter,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            background: "#E4573D",
            opacity: pulse,
            boxShadow: "0 0 18px #E4573D99",
          }}
        />
        <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: 6, color: "#E4573D" }}>{tag}</div>
        <div style={{ width: 1, height: 22, background: palette.line }} />
        <div style={{ fontSize: 21, letterSpacing: 4, color: palette.inkDim }}>深圳前海 · 现场连线</div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          top: 210,
          height: 1010,
          borderRadius: 30,
          overflow: "hidden",
          border: `1.5px solid ${palette.ink}2E`,
          boxShadow: `0 42px 110px #000A`,
          opacity: cardIn,
          transform: `translateY(${interpolate(cardIn, [0, 1], [70, 0])}px) scale(${interpolate(
            cardIn,
            [0, 1],
            [0.97, 1],
          )})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${staticFile(photo)})`,
            backgroundSize: "cover",
            backgroundPosition: "center 24%",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(180deg, transparent 52%, ${palette.bg}D9 82%, ${palette.bg} 100%)`,
          }}
        />
        <div style={{ ...corner({ left: 22, top: 22, borderWidth: "2px 0 0 2px" }, `${palette.accent}CC`) }} />
        <div style={{ ...corner({ right: 22, top: 22, borderWidth: "2px 2px 0 0" }, `${palette.accent}CC`) }} />
        <div style={{ ...corner({ left: 22, bottom: 22, borderWidth: "0 0 2px 2px" }, `${palette.accent}CC`) }} />
        <div style={{ ...corner({ right: 22, bottom: 22, borderWidth: "0 2px 2px 0" }, `${palette.accent}CC`) }} />

        <div style={{ position: "absolute", left: 40, right: 40, bottom: 38 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <div style={{ fontSize: 46, fontWeight: 800, color: palette.ink, letterSpacing: 1 }}>{name}</div>
            <div style={{ fontSize: 24, color: palette.accent, fontWeight: 700, letterSpacing: 3 }}>{role}</div>
          </div>
          <div
            style={{
              marginTop: 22,
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 20px",
              borderRadius: 8,
              background: `${palette.bg}D9`,
              border: `1px solid ${palette.line}`,
            }}
          >
            <div style={{ width: 6, height: 24, background: palette.accent }} />
            <div style={{ fontSize: 23, color: palette.inkDim, letterSpacing: 1 }}>现场报道 · 实时更新</div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          top: 1292,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [42, 0])}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
          <div style={{ width: 6, height: 34, borderRadius: 3, background: palette.accent }} />
          <div style={{ fontSize: 21, letterSpacing: 6, color: palette.accent, fontWeight: 700 }}>
            现 场 · 追 踪
          </div>
        </div>
        <div
          style={{
            fontSize: 82,
            lineHeight: 1.16,
            fontWeight: 800,
            color: palette.ink,
            whiteSpace: "pre-line",
          }}
        >
          {headline}
        </div>
        <div style={{ marginTop: 26, fontSize: 29, lineHeight: 1.6, color: palette.inkDim, width: 880 }}>
          {subline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
