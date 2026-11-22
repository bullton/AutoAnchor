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
  const { palette } = useStyle();
  return (
    <AbsoluteFill style={{ background: palette.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 55% at 78% 6%, ${palette.accentSoft} 0%, transparent 58%)`,
        }}
      />
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
