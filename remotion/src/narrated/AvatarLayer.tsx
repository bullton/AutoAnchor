import React from "react";
import { AbsoluteFill, Img, Video, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AVATAR_CLIP, useLayout } from "../components/LayoutContext";
import { useStyle } from "../components/StyleContext";
import { computeSafeBox } from "./layoutBox";

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;

export const AvatarLayer: React.FC = () => {
  const layout = useLayout();
  const { palette } = useStyle();
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  if (layout.mode === "none" || !layout.avatar || !layout.avatar.src) return null;

  const { rect } = computeSafeBox(layout, width, height);
  const { shape, fit, motion, borderWidth, borderColor, frame: shadow } = layout.avatar;
  const clip = AVATAR_CLIP[shape];
  const radius =
    shape === "circle" || shape === "ellipse"
      ? "50%"
      : shape === "rounded"
        ? Math.round(rect.width * 0.07)
        : 0;
  const ring = Math.max(0, Math.min(32, Number(borderWidth) || 0));
  const drift = motion === "float" ? Math.sin(frame / 26) * Math.min(8, rect.width / 60) : 0;
  const breathe = motion === "breathe" ? 1 + Math.sin(frame / 34) * 0.006 : 1;
  const isVideo = VIDEO_EXT.test(layout.avatar.src);
  const mediaStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: shape === "rounded" ? fit : "cover",
    objectPosition: "center 40%",
    display: "block",
  };
  const clipStyle: React.CSSProperties = clip
    ? { clipPath: clip }
    : { borderRadius: radius, overflow: "hidden" };

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: rect.left,
          top: rect.top + drift,
          width: rect.width,
          height: rect.height,
          transform: `scale(${breathe})`,
          transformOrigin: "center center",
          zIndex: 15,
          background: ring > 0 ? borderColor : "transparent",
          filter: shadow ? `drop-shadow(0 22px 46px ${palette.bg}CC)` : undefined,
          ...clipStyle,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: ring,
            background: palette.bgSoft,
            ...(clip
              ? { clipPath: clip }
              : { borderRadius: radius === "50%" ? "50%" : Math.max(0, Number(radius) - ring), overflow: "hidden" }),
          }}
        >
          {isVideo ? (
            <Video src={staticFile(layout.avatar.src)} style={mediaStyle} muted loop volume={0} />
          ) : (
            <Img src={staticFile(layout.avatar.src)} style={mediaStyle} />
          )}
        </div>
        {ring > 0 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              border: `1px solid ${palette.ink}14`,
              ...(clip ? { clipPath: clip } : { borderRadius: radius }),
            }}
          />
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
