import React from "react";
import { AbsoluteFill } from "remotion";
import { useStyle } from "../components/StyleContext";
import { SIDE } from "./tokens";

const MASTHEAD_WIDTH = 1080 - SIDE * 2 - 36;

function textUnits(text: string): number {
  let units = 0;
  for (const ch of Array.from(String(text || ""))) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x2e80) units += 1;
    else if (/[A-Za-z0-9]/.test(ch)) units += 0.56;
    else if (ch === " ") units += 0.32;
    else units += 0.5;
  }
  return units || 1;
}

function splitTitle(chars: string[]): number {
  if (chars.length <= 3) return chars.length;
  const total = textUnits(chars.join(""));
  let best = Math.ceil(chars.length / 2);
  let bestDiff = Infinity;
  for (let i = 1; i < chars.length; i += 1) {
    const diff = Math.abs(total - textUnits(chars.slice(0, i).join("")) * 2);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

export const Masthead: React.FC<{ title?: string; tagline?: string }> = ({ title, tagline }) => {
  const { palette, look } = useStyle();
  const seriesTitle = String(title || "").trim();
  const seriesTagline = String(tagline || "").trim();
  if (!seriesTitle) return null;
  const chars = Array.from(seriesTitle);
  const splitAt = splitTitle(chars);
  const lines = [chars.slice(0, splitAt).join(""), chars.slice(splitAt).join("")].filter(Boolean);
  const maxChars = Math.max(...lines.map((line) => Array.from(line).length));
  const maxUnits = Math.max(...lines.map((line) => textUnits(line)));
  const size = Math.max(64, Math.min(140, Math.floor((MASTHEAD_WIDTH - maxChars) / (maxUnits * 1.03))));
  const barHeight = Math.round(size * 1.02 * lines.length + (lines.length > 1 ? 4 : 0));
  const centered = look.titleAlign === "center";
  const barWidth = look.rule === "hairline" ? 3 : 6;

  const cornerMark = () => {
    const base: React.CSSProperties = {
      position: "absolute",
      right: SIDE,
      top: 162,
      background: palette.accent,
      opacity: 0.9,
    };
    if (look.marker === "square") return <div style={{ ...base, width: 14, height: 14 }} />;
    if (look.marker === "dot") return <div style={{ ...base, width: 14, height: 14, borderRadius: "50%" }} />;
    if (look.marker === "diamond") return <div style={{ ...base, width: 12, height: 12, transform: "rotate(45deg)" }} />;
    if (look.marker === "bracket")
      return (
        <div
          style={{
            position: "absolute",
            right: SIDE,
            top: 150,
            fontFamily: look.displayFont,
            fontSize: 34,
            fontWeight: 700,
            color: palette.accent,
            opacity: 0.9,
          }}
        >
          &#93;
        </div>
      );
    return <div style={{ ...base, width: 26, height: 4, borderRadius: 2 }} />;
  };

  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 60 }}>
      <div
        style={{
          position: "absolute",
          left: SIDE,
          right: SIDE,
          top: 76,
          display: "flex",
          flexDirection: centered ? "column" : "row",
          alignItems: centered ? "center" : "flex-start",
          gap: centered ? 18 : 30,
        }}
      >
        {centered ? (
          look.rule === "none" ? null : (
            <div
              style={{
                width: 88,
                height: barWidth,
                borderRadius: look.radius > 0 ? 999 : 0,
                background: palette.accent,
                boxShadow: `0 0 22px ${palette.accent}44`,
              }}
            />
          )
        ) : (
          <div
            style={{
              flex: "none",
              width: barWidth,
              height: barHeight,
              marginTop: 8,
              borderRadius: look.radius > 0 ? 3 : 0,
              background: `linear-gradient(180deg, ${palette.accent}, ${palette.accent}66 78%, transparent)`,
              boxShadow: `0 0 22px ${palette.accent}44`,
            }}
          />
        )}
        <div style={{ minWidth: 0, textAlign: centered ? "center" : "left" }}>
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: look.displayFont,
                fontSize: size,
                lineHeight: 1.02,
                fontWeight: look.titleWeight,
                letterSpacing: look.titleTracking,
                textTransform: look.titleTransform,
                color: i === 0 ? palette.ink : palette.accent,
                whiteSpace: "nowrap",
                textShadow: i === 0 ? "0 4px 26px rgba(0,0,0,0.55)" : "0 4px 26px rgba(0,0,0,0.5)",
                textAlign: centered ? "center" : "left",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
      {seriesTagline ? (
        <div
          style={{
            position: "absolute",
            left: SIDE,
            right: SIDE,
            top: 76 + barHeight + (centered ? 54 : 24),
            fontFamily: look.displayFont,
            fontSize: 28,
            lineHeight: 1.2,
            letterSpacing: look.kickerTracking,
            textTransform: look.kickerTransform,
            fontWeight: 500,
            color: palette.inkDim,
            textAlign: centered ? "center" : "left",
          }}
        >
          {seriesTagline}
        </div>
      ) : null}
      {cornerMark()}
    </AbsoluteFill>
  );
};
