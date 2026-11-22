import React from "react";
import { AbsoluteFill } from "remotion";
import { useStyle } from "../components/StyleContext";
import { SERIES_TITLE, SIDE } from "./tokens";

export const Masthead: React.FC<{ title?: string; tagline?: string }> = ({ title, tagline }) => {
  const { palette } = useStyle();
  const seriesTitle = String(title || SERIES_TITLE).trim() || SERIES_TITLE;
  const seriesTagline = String(tagline || "一条视频讲清楚").trim();
  const titleChars = Array.from(seriesTitle);
  const splitAt = titleChars.length > 4 ? Math.ceil(titleChars.length / 2) : titleChars.length;
  const first = titleChars.slice(0, splitAt).join("");
  const rest = titleChars.slice(splitAt).join("");
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 60 }}>
      <div
        style={{
          position: "absolute",
          left: SIDE,
          right: SIDE,
          top: 76,
          display: "flex",
          gap: 30,
        }}
      >
        <div
          style={{
            width: 6,
            height: 300,
            marginTop: 8,
            borderRadius: 3,
            background: `linear-gradient(180deg, ${palette.accent}, ${palette.accent}66 78%, transparent)`,
            boxShadow: `0 0 22px ${palette.accent}44`,
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 19,
              lineHeight: 1.2,
              fontWeight: 600,
              letterSpacing: 8,
              color: palette.accent,
            }}
          >
            {"生活指南"}
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 140,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: 1,
              color: palette.ink,
              textShadow: "0 4px 26px rgba(0,0,0,0.55)",
              whiteSpace: "nowrap",
            }}
          >
            {first}
          </div>
          <div
            style={{
              fontSize: 140,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: 1,
              color: palette.accent,
              textShadow: "0 4px 26px rgba(0,0,0,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            {rest}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            paddingTop: 10,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              transform: "rotate(45deg)",
              background: palette.accent,
              opacity: 0.9,
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: SIDE,
          right: SIDE,
          top: 438,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.2,
            letterSpacing: 4,
            fontWeight: 500,
            color: palette.inkDim,
          }}
        >
          {seriesTagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};
