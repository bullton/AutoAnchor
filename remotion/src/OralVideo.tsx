import { AbsoluteFill, Series } from "remotion";
import { AvatarStage } from "./components/AvatarStage";
import { LayoutContext, defaultLayout } from "./components/LayoutContext";
import { Progress } from "./components/Progress";
import { StyleContext, resolveStyle } from "./components/StyleContext";
import { NarratedVideo } from "./narrated/NarratedVideo";
import { BigNumberScene } from "./scenes/BigNumberScene";
import { BulletsScene } from "./scenes/BulletsScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { QuoteScene } from "./scenes/QuoteScene";
import { TitleScene } from "./scenes/TitleScene";
import type { SlideData, VideoProps } from "./types";

const renderScene = (slide: SlideData) => {
  switch (slide.type) {
    case "title":
      return <TitleScene slide={slide} />;
    case "bullets":
      return <BulletsScene slide={slide} />;
    case "number":
      return <BigNumberScene slide={slide} />;
    case "closing":
      return <ClosingScene slide={slide} />;
    case "quote":
    default:
      return <QuoteScene slide={slide} />;
  }
};

const LegacyVideo = ({ slides }: VideoProps) => (
  <Series>
    {slides.map((slide) => (
      <Series.Sequence key={slide.id} durationInFrames={slide.durationInFrames}>
        {renderScene(slide)}
      </Series.Sequence>
    ))}
  </Series>
);

export const OralVideo = (props: VideoProps) => {
  const resolved = resolveStyle(props.style);

  if (props.scenes && props.scenes.length > 0) {
    return (
      <StyleContext.Provider value={resolved}>
        <LayoutContext.Provider value={props.layout ?? defaultLayout}>
          <NarratedVideo {...props} />
        </LayoutContext.Provider>
      </StyleContext.Provider>
    );
  }

  if (!props.slides || props.slides.length === 0) {
    return <AbsoluteFill style={{ background: resolved.palette.bg }} />;
  }

  return (
    <StyleContext.Provider value={resolved}>
      <LayoutContext.Provider value={props.layout ?? defaultLayout}>
        <AbsoluteFill style={{ background: resolved.palette.bg, fontFamily: resolved.palette.font }}>
          <LegacyVideo {...props} />
          <AvatarStage />
          <Progress />
        </AbsoluteFill>
      </LayoutContext.Provider>
    </StyleContext.Provider>
  );
};
