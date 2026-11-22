import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { StyleContext, resolveStyle } from "../components/StyleContext";
import { useStyle } from "../components/StyleContext";
import { ChapterWipe } from "./ChapterWipe";
import { KaraokeCaptions } from "./KaraokeCaptions";
import { PresenterCard } from "./PresenterCard";

const ChapterScene: React.FC<{
  index: string;
  kicker: string;
  title: string;
  subline: string;
  photo: string;
}> = ({ index, kicker, title, subline, photo }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { palette } = useStyle();
  const enter = spring({ frame: frame - 12, fps, config: { damping: 15, stiffness: 90 } });
  return (
    <AbsoluteFill style={{ background: palette.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile(photo)})`,
          backgroundSize: "cover",
          backgroundPosition: "center 46%",
          transform: `scale(${interpolate(frame, [0, 150], [1.05, 1.12])})`,
          filter: "saturate(0.65)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(178deg, ${palette.bg}59 0%, ${palette.bg}D9 46%, ${palette.bg} 82%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          top: 300,
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [56, 0])}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, color: `${palette.ink}22` }}>{index}</div>
          <div style={{ width: 92, height: 3, background: palette.accent }} />
          <div style={{ fontSize: 23, letterSpacing: 8, color: palette.accent, fontWeight: 700 }}>{kicker}</div>
        </div>
        <div
          style={{
            marginTop: 54,
            fontSize: 118,
            lineHeight: 1.1,
            fontWeight: 800,
            letterSpacing: 2,
            color: palette.ink,
            whiteSpace: "pre-line",
          }}
        >
          {title}
        </div>
        <div style={{ marginTop: 42, width: 860, fontSize: 32, lineHeight: 1.65, color: palette.inkDim }}>
          {subline}
        </div>

        <div style={{ marginTop: 64, display: "flex", gap: 14 }}>
          {["媒体互动", "产业合作", "城市叙事"].map((tag, i) => (
            <div
              key={tag}
              style={{
                padding: "14px 26px",
                borderRadius: 999,
                border: `1.5px solid ${i === 0 ? `${palette.accent}99` : palette.line}`,
                background: i === 0 ? palette.accentSoft : `${palette.bg}80`,
                color: i === 0 ? palette.accent : palette.inkDim,
                fontSize: 25,
                fontWeight: 700,
                letterSpacing: 2,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 66,
          right: 66,
          bottom: 120,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: `1px solid ${palette.line}`,
          paddingTop: 28,
          opacity: enter,
        }}
      >
        <div style={{ fontSize: 21, letterSpacing: 4, color: palette.inkFaint }}>移植样片 · PORTS DEMO</div>
        <div style={{ fontSize: 21, letterSpacing: 4, color: palette.inkFaint }}>TRANSITION · FRAME · CAPTION</div>
      </div>
    </AbsoluteFill>
  );
};

export const PortsDemo: React.FC = () => {
  const style = resolveStyle({ id: "amber", motion: "standard" });
  return (
    <StyleContext.Provider value={style}>
      <AbsoluteFill style={{ background: style.palette.bg, fontFamily: style.palette.font }}>
        <Sequence durationInFrames={150}>
          <PresenterCard
            photo="photos/reporter-portrait.jpg"
            name="陈曦"
            role="前方记者"
            headline={"深圳前海\n现场直击"}
            subline="抵达、会谈与产业走访同步推进，我们跟拍每一个信号。"
          />
        </Sequence>

        <Sequence from={150} durationInFrames={150}>
          <KaraokeCaptions
            photo="photos/press-conference.jpg"
            text="特朗普抵达深圳，全球媒体高度关注此次行程。"
            speaker="现场 · 记者 陈曦"
          />
          <ChapterWipe index="02" label="现 场 信 号" />
        </Sequence>

        <Sequence from={300} durationInFrames={150}>
          <ChapterScene
            index="03"
            kicker="信 号 解 读"
            title={"深圳一站\n释放哪些信号"}
            subline="媒体互动、产业合作与城市叙事，三条线索同时展开。"
            photo="photos/shenzhen-skyline.jpg"
          />
          <ChapterWipe index="03" label="互 动 提 问" />
        </Sequence>
      </AbsoluteFill>
    </StyleContext.Provider>
  );
};
