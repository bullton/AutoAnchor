import React from "react";
import { Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "../components/StyleContext";
import { bodyWrapStyle, useLayout } from "../components/LayoutContext";
import type { SceneData } from "../types";
import { useSafeBox } from "./layoutBox";
import { motionIntensity, motionSpeed, useSceneMotion } from "./sceneMotion";
import { sceneContentGeometry } from "./sceneContent";
import { PHOTO_H, SAFE_BOTTOM, SIDE, TITLE_H, WIDTH, photoFillHeight } from "./tokens";
import { splitTitleLines, textUnits } from "./titleBreak";

const titleSize = (text: string): number => {
  const n = text.length;
  if (n <= 8) return 92;
  if (n <= 14) return 78;
  if (n <= 20) return 66;
  if (n <= 28) return 56;
  return 48;
};

export const Headline: React.FC<{
  text: string;
  start?: number;
  align?: "left" | "center";
  color?: string;
  size?: number;
  maxWidth?: number;
}> = ({ text, start = 0, align = "left", color, size, maxWidth }) => {
  const { palette, look } = useStyle();
  const frame = useCurrentFrame();
  const motion = useSceneMotion();
  const I = motionIntensity(motion);
  const speed = motionSpeed(motion);
  const dur = Math.max(10, Math.round(18 * speed));
  const enter = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  let anim: React.CSSProperties = {
    opacity: enter,
    transform: `translateY(${(1 - enter) * 26 * I}px)`,
  };
  let shown = text;
  if (motion) {
    if (motion.title === "mask") {
      anim = { opacity: 1, clipPath: `inset(0 0 ${(1 - enter) * 100}% 0)` };
    } else if (motion.title === "pop") {
      anim = {
        opacity: Math.min(enter * 1.3, 1),
        transform: `scale(${0.92 + enter * 0.08})`,
      };
    } else if (motion.title === "typewriter") {
      const n = Math.round(Array.from(text).length * enter);
      shown = Array.from(text).slice(0, n).join("");
      anim = { opacity: 1 };
    } else if (motion.title === "none") {
      anim = { opacity: 1 };
    } else {
      anim = {
        opacity: Math.min(enter * 1.2, 1),
        transform: `translateY(${(1 - enter) * 52 * I}px)`,
      };
    }
  }

  return (
    <div
      style={{
        ...anim,
        color: color ?? palette.ink,
        fontFamily: look.displayFont,
        fontSize: size ?? titleSize(text),
        lineHeight: 1.34,
        fontWeight: look.titleWeight,
        letterSpacing: look.titleTracking,
        textTransform: look.titleTransform,
        textAlign: align,
        maxWidth,
        whiteSpace: "pre-wrap",
      }}
    >
      {shown}
    </div>
  );
};

export const Marker: React.FC<{ active?: boolean; marginTop?: number; width?: number; height?: number }> = ({
  active = false,
  marginTop = 0,
  width = 30,
  height = 4,
}) => {
  const { palette, look } = useStyle();
  const color = active ? palette.accent : palette.inkFaint;
  const wrap: React.CSSProperties = { flex: "0 0 auto", marginTop };
  if (look.marker === "square") {
    return <div style={{ ...wrap, width: 15, height: 15, background: color }} />;
  }
  if (look.marker === "diamond") {
    return <div style={{ ...wrap, width: 13, height: 13, background: color, transform: "rotate(45deg)" }} />;
  }
  if (look.marker === "dot") {
    return <div style={{ ...wrap, width: 13, height: 13, borderRadius: "50%", background: color }} />;
  }
  if (look.marker === "bracket") {
    return (
      <div
        style={{
          ...wrap,
          fontFamily: look.displayFont,
          fontSize: 30,
          lineHeight: 1,
          fontWeight: 700,
          color,
        }}
      >
        [
      </div>
    );
  }
  return (
    <div
      style={{
        ...wrap,
        width,
        height,
        borderRadius: look.radius > 0 ? height / 2 : 0,
        background: color,
      }}
    />
  );
};

export const TitleBar: React.FC<{ kicker: string; title: string; overlay?: boolean }> = ({
  kicker,
  title,
  overlay = false,
}) => {
  const { palette, look } = useStyle();
  const frame = useCurrentFrame();
  const box = useSafeBox();
  const centered = look.titleAlign === "center";
  const enter = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const titleChars = Array.from(String(title || ""));
  const titleLines = splitTitleLines(title || "");
  const maxChars = Math.max(1, ...titleLines.map((line) => Array.from(line).length));
  const maxUnits = Math.max(1, ...titleLines.map((line) => textUnits(line)));
  const barTitleSize = titleChars.length
    ? Math.max(34, Math.min(54, Math.floor((box.width - maxChars * 1.2) / (maxUnits * 1.03))))
    : 54;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIDTH,
        height: TITLE_H,
        overflow: "hidden",
        opacity: enter,
        zIndex: 20,
        background: overlay
          ? `linear-gradient(180deg, ${palette.bg}F2 0%, ${palette.bg}DE 42%, ${palette.bg}A8 68%, ${palette.bg}52 86%, ${palette.bg}00 100%)`
          : `linear-gradient(100deg, ${palette.bgSoft} 0%, ${palette.bg} 62%, ${palette.bgSoft} 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: overlay
            ? "none"
            : `radial-gradient(120% 160% at 92% 0%, ${palette.accentSoft} 0%, transparent 58%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: box.left,
          top: 500,
          width: box.width,
          height: 140,
          display: "flex",
          alignItems: "center",
          transform: `translateY(${(1 - enter) * -18}px)`,
        }}
      >
        <div
          style={{
            fontFamily: look.displayFont,
            fontSize: barTitleSize,
            lineHeight: 1.22,
            letterSpacing: look.titleTracking,
            fontWeight: look.titleWeight,
            textTransform: look.titleTransform,
            color: palette.ink,
            whiteSpace: "normal",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            maxWidth: box.width,
            width: "100%",
            textAlign: centered ? "center" : "left",
            textShadow: "0 3px 22px rgba(0,0,0,0.5)",
          }}
        >
          {titleLines.map((line, index) => (
            <div key={index} style={{ whiteSpace: "nowrap" }}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PhotoLayer: React.FC<{
  src?: string | null;
  variant?: "band" | "hero" | "half" | "backdrop";
  duration: number;
  focus?: string;
  dim?: number;
  start?: number;
  ghost?: string;
  label?: string;
  aspect?: number | null;
}> = ({ src, variant = "band", duration, focus = "center 38%", dim = 0.5, start = 0, ghost, label, aspect }) => {
  const { palette, look } = useStyle();
  const frame = useCurrentFrame();
  const motion = useSceneMotion();
  const I = motionIntensity(motion);
  const prog = interpolate(frame - start, [0, Math.max(1, duration)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const k = interpolate(prog, [0, 1], [1.04, 1.04 + 0.07 * I]);
  const photoKind = motion?.photo;
  const photoTransform =
    photoKind === "none"
      ? "none"
      : photoKind === "parallax"
        ? `translateY(${(prog - 0.5) * 44 * I}px) scale(1.1)`
        : `scale(${photoKind === "pan" ? 1.12 : k})`;
  const focusParts = String(focus).split(" ");
  const focusY = focusParts[1] || "38%";
  const photoPosition =
    photoKind === "pan" ? `${50 + (prog - 0.5) * 12 * I}% ${focusY}` : focus;
  const appear = interpolate(frame, [start, start + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const box: React.CSSProperties =
    variant === "band"
      ? {
          position: "absolute",
          left: 0,
          top: 0,
          width: WIDTH,
          height: photoFillHeight(aspect),
        }
      : { position: "absolute", inset: 0 };

  const overlay =
    variant === "hero"
      ? `linear-gradient(168deg, ${palette.bg}B8 0%, ${palette.bg}33 46%, ${palette.bg}D9 100%)`
      : variant === "band"
        ? `linear-gradient(180deg, ${palette.bg}00 0%, ${palette.bg}00 18%, ${palette.bg}38 34%, ${palette.bg}80 50%, ${palette.bg}B8 64%, ${palette.bg}D9 78%, ${palette.bg}E8 92%)`
        : variant === "backdrop"
          ? "none"
          : `linear-gradient(180deg, ${palette.bg}22 0%, ${palette.bg}2E 55%, ${palette.bg}E6 100%)`;
  const topScrim = `linear-gradient(180deg, ${palette.bg}E6 0%, ${palette.bg}A8 22%, ${palette.bg}33 38%, ${palette.bg}00 52%)`;
  const bottomScrim = `linear-gradient(180deg, ${palette.bg}00 0%, ${palette.bg}00 38%, ${palette.bg}33 52%, ${palette.bg}AA 68%, ${palette.bg}E6 84%, ${palette.bg}F2 100%)`;

  return (
    <div style={{ ...box, overflow: "hidden", opacity: appear }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(155deg, ${palette.bgSoft} 0%, ${palette.bg} 58%, ${palette.bgSoft} 100%)`,
        }}
      />
      {src ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${staticFile(src)})`,
            backgroundSize: "cover",
            backgroundPosition: photoPosition,
            transform: photoTransform,
            filter: "brightness(1.12) saturate(1.04)",
          }}
        />
      ) : (
        <>
          <AbstractTexture />
          {ghost ? (
            <div
              style={{
                position: "absolute",
                left: SIDE,
                top: 0,
                height: "100%",
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  fontFamily: look.displayFont,
                  fontSize: 148,
                  fontWeight: look.titleWeight,
                  lineHeight: 1,
                  letterSpacing: look.titleTracking - 2,
                  color: palette.ink,
                  opacity: 0.07,
                }}
              >
                {ghost}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ width: 54, height: 2, background: palette.accent, opacity: 0.7 }} />
                <div
                  style={{
                    fontSize: 22,
                    letterSpacing: 5,
                    fontWeight: 600,
                    color: palette.inkFaint,
                  }}
                >
                  {label || ""}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
      {variant === "backdrop" ? (
        <>
          <div style={{ position: "absolute", inset: 0, background: topScrim }} />
          <div style={{ position: "absolute", inset: 0, background: bottomScrim }} />
        </>
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, background: overlay }} />
          {dim > 0 ? (
            <div style={{ position: "absolute", inset: 0, background: palette.bg, opacity: Math.min(0.18, dim * 0.4) }} />
          ) : null}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(200deg, ${palette.accent}12 0%, transparent 45%)`,
              mixBlendMode: "soft-light",
            }}
          />
        </>
      )}
    </div>
  );
};

/** 无实拍图时的抽象纹理：等距斜�?+ 光斑，代替空�?*/
export const AbstractTexture: React.FC = () => {
  const { palette } = useStyle();
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(90% 70% at 76% 18%, ${palette.accentSoft} 0%, transparent 62%)`,
        }}
      />
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <line
            key={i}
            x1={-220 + i * 110}
            y1={0}
            x2={-40 + i * 110}
            y2={PHOTO_H + 200}
            stroke={palette.line}
            strokeWidth={1}
          />
        ))}
      </svg>
    </div>
  );
};

export const PlotGrid: React.FC<{ duration: number; height?: number }> = ({
  duration,
  height = photoFillHeight(null),
}) => {
  const { palette } = useStyle();
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [0, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cols = [0.16, 0.1, 0.13, 0.09, 0.14, 0.11, 0.12];
  const rows = [0.3, 0.36, 0.34];
  let x = 0;
  const plots: { x: number; y: number; w: number; h: number }[] = [];
  cols.forEach((cw) => {
    let y = 0;
    rows.forEach((rh) => {
      plots.push({ x: x + 6, y: y + 6, w: WIDTH * cw - 12, h: height * rh - 12 });
      y += height * rh;
    });
    x += WIDTH * cw;
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: WIDTH,
        height,
        overflow: "hidden",
        opacity: appear,
      }}
    >
      <svg width={WIDTH} height={height}>
        <rect x={0} y={0} width={WIDTH} height={height} fill={palette.bg} />
        {plots.map((p, i) => (
          <rect
            key={i}
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            rx={8}
            fill={i === 12 ? palette.accentSoft : "rgba(255,255,255,0.018)"}
            stroke={palette.accent}
            strokeOpacity={i === 12 ? 0.42 : 0.16}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, transparent 18%, ${palette.bg}38 34%, ${palette.bg}80 50%, ${palette.bg}B8 64%, ${palette.bg}D9 78%, ${palette.bg}E8 92%)`,
        }}
      />
    </div>
  );
};

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  appear?: number;
  base?: number;
}> = ({ children, style, appear = 1, base = 0 }) => {
  const { palette, look } = useStyle();
  const opacity = base === 0 ? appear : base + appear * (1 - base);
  return (
    <div
      style={{
        background: palette.bgSoft,
        border: `${look.rule === "none" ? 1 : 1.5}px solid ${palette.line}`,
        borderRadius: look.radius,
        padding: "24px 28px",
        opacity,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Chip: React.FC<{
  text: string;
  appear: number;
  highlight?: boolean;
}> = ({ text, appear, highlight = false }) => {
  const { palette, look } = useStyle();
  return (
    <div
      style={{
        opacity: appear,
        transform: `translateY(${(1 - appear) * 14}px)`,
        padding: "15px 26px",
        borderRadius: look.kickerShape === "pill" ? 999 : look.radius,
        border: `1.5px solid ${highlight ? palette.accent : palette.line}`,
        background: highlight ? palette.accentSoft : "transparent",
        color: highlight ? palette.accent : palette.inkDim,
        fontSize: 27,
        fontWeight: 600,
        letterSpacing: 1,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
};

export const StatCard: React.FC<{
  label: string;
  value: string;
  unit?: string;
  appear: number;
  highlight?: boolean;
}> = ({ label, value, unit = "", appear, highlight = false }) => {
  const { palette, look } = useStyle();
  return (
    <div
      style={{
        flex: 1,
        padding: "26px 22px",
        borderRadius: look.radius,
        background: palette.bgSoft,
        border: `1.5px solid ${highlight ? `${palette.accent}66` : palette.line}`,
        textAlign: "center",
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px)`,
      }}
    >
      <div style={{ fontSize: 23, color: palette.inkDim, letterSpacing: look.kickerTracking }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontFamily: look.displayFont,
          fontSize: 72,
          fontWeight: look.titleWeight,
          color: highlight ? palette.accent : palette.ink,
          letterSpacing: -1,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
        {unit ? <span style={{ fontSize: 34, marginLeft: 6 }}>{unit}</span> : null}
      </div>
    </div>
  );
};

export const BarRow: React.FC<{
  label: string;
  value: string;
  ratio: number;
  appear: number;
  highlight?: boolean;
  rank?: string;
}> = ({ label, value, ratio, appear, highlight = false, rank }) => {
  const { palette, look } = useStyle();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        opacity: 0.3 + appear * 0.7,
        transform: `translateX(${(1 - appear) * -22}px)`,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          width: 44,
          fontSize: 22,
          fontWeight: 700,
          color: highlight ? palette.accent : palette.inkFaint,
          letterSpacing: 1,
        }}
      >
        {rank}
      </div>
      <div
        style={{
          width: 200,
          fontSize: highlight ? 26 : 24,
          fontWeight: highlight ? 700 : 500,
          color: highlight ? palette.ink : palette.inkDim,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: highlight ? 26 : 20 }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(1, ratio)) * 100 * appear}%`,
            height: "100%",
            borderRadius: look.radius > 0 ? 6 : 0,
            background: highlight
              ? `linear-gradient(90deg, ${palette.accent}88, ${palette.accent})`
              : palette.line,
          }}
        />
      </div>
      <div
        style={{
          width: 116,
          textAlign: "right",
          fontSize: highlight ? 26 : 23,
          fontWeight: 700,
          color: highlight ? palette.accent : palette.inkDim,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
};

export const Credit: React.FC<{ text: string; appear: number }> = ({ text, appear }) => {
  const { palette } = useStyle();
  const box = useSafeBox();
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        right: box.right,
        bottom: Math.max(SAFE_BOTTOM + 24, box.bottom + 24),
        textAlign: "center",
        fontSize: 16,
        lineHeight: 1.5,
        letterSpacing: 0.3,
        color: palette.inkFaint,
        opacity: appear,
      }}
    >
      {text}
    </div>
  );
};

export const Body: React.FC<{ scene: SceneData; children: React.ReactNode; style?: React.CSSProperties }> = ({
  scene,
  children,
  style,
}) => {
  const box = useSafeBox();
  const layout = useLayout();
  const { palette } = useStyle();
  const { height } = useVideoConfig();
  const geometry = sceneContentGeometry(scene, box, height);
  return (
    <div
      style={{
        position: "absolute",
        left: geometry.contentLeft,
        top: geometry.contentTop,
        width: geometry.contentWidth,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        textAlign: geometry.contentAlign,
        ...style,
      }}
    >
      <div
        style={{
          ...bodyWrapStyle(layout.body),
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
        }}
      >
        {scene.kicker ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Marker active />
            <div
              style={{
                fontSize: 22,
                letterSpacing: 4,
                color: palette.accent,
                fontWeight: 600,
                textShadow: "0 2px 10px rgba(0,0,0,0.65)",
              }}
            >
              {scene.kicker}
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
};
