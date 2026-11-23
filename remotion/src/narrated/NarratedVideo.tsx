import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { useStyle } from "../components/StyleContext";
import type { SceneData, VideoProps } from "../types";
import { MaterialLayout, SCENE_RENDERERS } from "./layouts";
import { SceneShell } from "./SceneShell";
import { AvatarLayer } from "./AvatarLayer";
import { Masthead } from "./Masthead";
import { MotionProvider } from "./sceneMotion";

const Background: React.FC = () => {
  const { palette, look } = useStyle();
  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      {look.pattern === "glow" ? (
        <>
          <AbsoluteFill
            style={{
              background: `radial-gradient(70% 46% at 20% 6%, ${palette.accent}38 0%, transparent 62%), radial-gradient(64% 44% at 84% 92%, ${palette.accent}2E 0%, transparent 62%)`,
            }}
          />
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${palette.bgSoft}88 0%, transparent 42%, ${palette.bgSoft}66 100%)`,
            }}
          />
        </>
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(90% 55% at 78% 6%, ${palette.accentSoft} 0%, transparent 58%)`,
          }}
        />
      )}
      {look.pattern === "lines" ? (
        <AbsoluteFill style={{ opacity: 0.5 }}>
          <svg width="100%" height="100%">
            {Array.from({ length: 24 }).map((_, i) => (
              <line
                key={i}
                x1={0}
                y1={80 + i * 84}
                x2="100%"
                y2={80 + i * 84}
                stroke={palette.line}
                strokeWidth={0.6}
                opacity={i % 4 === 0 ? 0.7 : 0.28}
              />
            ))}
          </svg>
        </AbsoluteFill>
      ) : null}
      {look.pattern === "grid" ? (
        <AbsoluteFill style={{ opacity: 0.55 }}>
          <svg width="100%" height="100%">
            {Array.from({ length: 28 }).map((_, i) => (
              <line
                key={`h${i}`}
                x1={0}
                y1={i * 72}
                x2="100%"
                y2={i * 72}
                stroke={palette.line}
                strokeWidth={0.6}
                opacity={i % 3 === 0 ? 0.8 : 0.3}
              />
            ))}
            {Array.from({ length: 13 }).map((_, i) => (
              <line
                key={`v${i}`}
                x1={i * 90}
                y1={0}
                x2={i * 90}
                y2="100%"
                stroke={palette.line}
                strokeWidth={0.6}
                opacity={i % 3 === 0 ? 0.7 : 0.26}
              />
            ))}
          </svg>
        </AbsoluteFill>
      ) : null}
      {look.pattern === "scan" ? (
        <AbsoluteFill
          style={{
            backgroundImage: `repeating-linear-gradient(180deg, ${palette.line} 0px, ${palette.line} 1px, transparent 1px, transparent 6px)`,
            opacity: 0.55,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const creditText = (props: VideoProps) => {
  const list = props.meta?.credits || [];
  if (!list.length) return "";
  const seen = new Set<string>();
  const text = list
    .filter((c) => {
      const key = `${c.author}|${c.license}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => [c.author, c.license].filter(Boolean).join(" · "))
    .filter(Boolean)
    .join(" ／ ");
  return text ? `图片：${text}` : "";
};

export const NarratedVideo: React.FC<VideoProps> = (props) => {
  const { palette } = useStyle();
  const resolvedFont = palette.font;
  const scenes = props.scenes || [];
  const credits = creditText(props);

  return (
    <AbsoluteFill style={{ fontFamily: resolvedFont }}>
      <Background />
      <Series>
        {scenes.map((scene: SceneData) => {
          const isMaterial =
            scene.photoSource === "material" || /(^|\/)custom-[^/]+$/i.test(String(scene.photo || ""));
          const Renderer =
            isMaterial && scene.photo && scene.layout !== "closing"
              ? MaterialLayout
              : SCENE_RENDERERS[scene.layout] || SCENE_RENDERERS.band;
          const withCredits =
            scene.layout === "closing" ? ({ ...scene, credits } as SceneData & { credits: string }) : scene;
          return (
            <Series.Sequence key={scene.id} durationInFrames={scene.durationInFrames}>
              <MotionProvider motion={scene.motion}>
                <SceneShell duration={scene.durationInFrames}>
                  <Renderer scene={withCredits} />
                </SceneShell>
              </MotionProvider>
            </Series.Sequence>
          );
        })}
      </Series>
      <AvatarLayer />
      <Masthead title={props.meta?.seriesTitle} tagline={props.meta?.seriesTagline} />
    </AbsoluteFill>
  );
};
