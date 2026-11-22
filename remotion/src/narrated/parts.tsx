import React from "react";
import { Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import { useStyle } from "../components/StyleContext";
import { useSafeBox } from "./layoutBox";
import { motionIntensity, motionSpeed, useSceneMotion } from "./sceneMotion";
import { PHOTO_H, SAFE_BOTTOM, SIDE, TEXT_ANCHOR, TITLE_H, WIDTH, photoFillHeight } from "./tokens";

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
  const { palette } = useStyle();
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
        fontSize: size ?? titleSize(text),
        lineHeight: 1.34,
        fontWeight: 700,
        letterSpacing: 0.8,
        textAlign: align,
        maxWidth,
        whiteSpace: "pre-wrap",
      }}
    >
      {shown}
    </div>
  );
};

export const TitleBar: React.FC<{ kicker: string; title: string; overlay?: boolean }> = ({
  kicker,
  title,
  overlay = false,
}) => {
  const { palette } = useStyle();
  const frame = useCurrentFrame();
  const box = useSafeBox();
  const enter = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
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
          top: 520,
          height: TITLE_H - 520,
          display: "flex",
          alignItems: "center",
          transform: `translateY(${(1 - enter) * -18}px)`,
          maxWidth: box.width,
        }}
      >
        <div
          style={{
            fontSize: 54,
            lineHeight: 1.22,
            letterSpacing: 1.2,
            fontWeight: 700,
            color: palette.ink,
            whiteSpace: "normal",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            maxWidth: box.width,
            textShadow: "0 3px 22px rgba(0,0,0,0.5)",
          }}
        >
          {title}
        </div>
      </div>
    </div>
  );
};

export const PhotoLayer: React.FC<{
  src?: string | null;
  variant?: "band" | "hero" | "half";
  duration: number;
  focus?: string;
  dim?: number;
  start?: number;
  ghost?: string;
  label?: string;
  aspect?: number | null;
}> = ({ src, variant = "band", duration, focus = "center 38%", dim = 0.5, start = 0, ghost, label, aspect }) => {
  const { palette } = useStyle();
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
      ? `linear-gradient(168deg, ${palette.bg}CC 0%, ${palette.bg}44 46%, ${palette.bg}E8 100%)`
      : variant === "band"
        ? `linear-gradient(180deg, ${palette.bg}00 0%, ${palette.bg}00 18%, ${palette.bg}42 34%, ${palette.bg}94 50%, ${palette.bg}C9 64%, ${palette.bg}E8 78%, ${palette.bg} 92%)`
        : `linear-gradient(180deg, ${palette.bg}22 0%, ${palette.bg}2E 55%, ${palette.bg}E6 100%)`;

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
            filter: "brightness(1.06) saturate(1.04)",
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
                  fontSize: 148,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: -4,
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
      <div style={{ position: "absolute", inset: 0, background: overlay }} />
      {dim > 0 ? (
        <div style={{ position: "absolute", inset: 0, background: palette.bg, opacity: Math.min(0.5, dim * 0.7) }} />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(200deg, ${palette.accent}12 0%, transparent 45%)`,
          mixBlendMode: "soft-light",
        }}
      />
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
          background: `linear-gradient(180deg, transparent 18%, ${palette.bg}42 34%, ${palette.bg}94 50%, ${palette.bg}C9 64%, ${palette.bg}E8 78%, ${palette.bg} 92%)`,
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
  const { palette } = useStyle();
  const opacity = base === 0 ? appear : base + appear * (1 - base);
  return (
    <div
      style={{
        background: palette.bgSoft,
        border: `1.5px solid ${palette.line}`,
        borderRadius: 20,
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
  const { palette } = useStyle();
  return (
    <div
      style={{
        opacity: appear,
        transform: `translateY(${(1 - appear) * 14}px)`,
        padding: "15px 26px",
        borderRadius: 999,
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
  const { palette } = useStyle();
  return (
    <div
      style={{
        flex: 1,
        padding: "26px 22px",
        borderRadius: 22,
        background: palette.bgSoft,
        border: `1.5px solid ${highlight ? `${palette.accent}66` : palette.line}`,
        textAlign: "center",
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px)`,
      }}
    >
      <div style={{ fontSize: 23, color: palette.inkDim, letterSpacing: 3 }}>{label}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 72,
          fontWeight: 800,
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
  const { palette } = useStyle();
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
            borderRadius: 6,
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

export const Body: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => {
  const box = useSafeBox();
  return (
    <div
      style={{
        position: "absolute",
        left: box.left,
        right: box.right,
        top: Math.max(TEXT_ANCHOR, box.top),
        bottom: Math.max(box.contentBottom, box.bottom),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "26px 0 0",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
