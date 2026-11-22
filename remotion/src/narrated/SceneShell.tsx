import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { useStyle } from "../components/StyleContext";
import { motionIntensity, motionSpeed, useSceneMotion } from "./sceneMotion";
import { TITLE_H } from "./tokens";

const FADE = 10;

export const SceneShell: React.FC<{
  duration: number;
  fadeOut?: boolean;
  children: React.ReactNode;
}> = ({ duration, fadeOut = true, children }) => {
  const frame = useCurrentFrame();
  const { palette } = useStyle();
  const motion = useSceneMotion();
  const I = motionIntensity(motion);
  const speed = motionSpeed(motion);
  const enterFrames = Math.max(10, Math.round(18 * speed));
  const exitFrames = Math.max(8, Math.round(FADE * speed));

  const inO = interpolate(frame, [0, enterFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const outStart = Math.max(duration - exitFrames, enterFrames);
  const outO = fadeOut
    ? interpolate(frame, [outStart, duration], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  let enterStyle: React.CSSProperties = {
    opacity: Math.min(inO * 1.15, 1),
    transform: `translateY(${(1 - inO) * 26}px)`,
  };
  if (motion) {
    switch (motion.enter) {
      case "rise":
        enterStyle = {
          opacity: Math.min(inO * 1.2, 1),
          transform: `translateY(${(1 - inO) * 52 * I}px)`,
        };
        break;
      case "slide":
        enterStyle = {
          opacity: Math.min(inO * 1.2, 1),
          transform: `translateX(${(1 - inO) * 96 * I}px)`,
        };
        break;
      case "zoom":
        enterStyle = {
          opacity: Math.min(inO * 1.2, 1),
          transform: `scale(${1 + (1 - inO) * 0.055 * I})`,
        };
        break;
      case "blur":
        enterStyle = {
          opacity: Math.min(inO * 1.2, 1),
          filter: `blur(${(1 - inO) * 16 * I}px)`,
        };
        break;
      case "wipe":
        enterStyle = {
          opacity: 1,
          clipPath: `inset(0 0 ${(1 - inO) * 100}% 0)`,
        };
        break;
      default:
        break;
    }
  }

  let exitStyle: React.CSSProperties = {};
  if (motion && fadeOut) {
    if (motion.exit === "wipe") {
      exitStyle = { clipPath: `inset(${(1 - outO) * 100}% 0 0 0)`, opacity: 1 };
    } else if (motion.exit === "none") {
      exitStyle = { opacity: 1 };
    }
  }

  const sweep = motion?.accent === "sweep";
  const pulse = motion?.accent === "pulse";
  const bar = motion?.accent === "bar";
  const beam = interpolate(frame, [0, Math.max(14, Math.round(30 * speed))], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pulseO = interpolate(frame, [0, 6, 22], [0, 0.5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const outerOpacity = motion && motion.exit === "none" ? 1 : outO;

  return (
    <AbsoluteFill style={{ opacity: fadeOut ? outerOpacity : 1, ...enterStyle, ...exitStyle }}>
      {children}
      {sweep ? (
        <AbsoluteFill style={{ zIndex: 40, pointerEvents: "none", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              top: -200,
              bottom: -200,
              width: 240,
              left: `${-26 + beam * 140}%`,
              transform: "rotate(14deg)",
              background: `linear-gradient(90deg, transparent, ${palette.accent}2E, ${palette.ink}22, transparent)`,
              mixBlendMode: "screen",
              opacity: motion ? 1 : 0,
            }}
          />
        </AbsoluteFill>
      ) : null}
      {pulse ? (
        <AbsoluteFill style={{ zIndex: 40, pointerEvents: "none" }}>
          <div
            style={{
              position: "absolute",
              right: 90,
              top: TITLE_H + 26,
              width: 150 * I,
              height: 150 * I,
              borderRadius: "50%",
              border: `2px solid ${palette.accent}`,
              opacity: pulseO,
              transform: `scale(${0.7 + beam * 0.9})`,
            }}
          />
        </AbsoluteFill>
      ) : null}
      {bar ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: TITLE_H - 3,
            height: 3,
            width: `${Math.min(1, beam * 1.4) * 100}%`,
            background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent}00)`,
            zIndex: 40,
            opacity: 0.9,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
