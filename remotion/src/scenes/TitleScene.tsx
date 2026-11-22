import { useRise, useWipe } from "../components/anim";
import { Frame } from "../components/Frame";
import { useStyle } from "../components/StyleContext";
import { titleSize } from "../theme";
import type { SlideData } from "../types";

export const TitleScene = ({ slide }: { slide: SlideData }) => {
  const { palette } = useStyle();
  const kicker = useRise(0, 18);
  const title = useRise(6, 54);
  const line = useWipe(16, 16);
  const caption = useRise(24, 24);

  return (
    <Frame>
      {slide.kicker ? (
        <div
          style={{
            ...kicker,
            color: palette.accent,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.1em",
          }}
        >
          {slide.kicker}
        </div>
      ) : null}
      <div
        style={{
          ...title,
          marginTop: 34,
          color: palette.ink,
          fontSize: titleSize(slide.title),
          lineHeight: 1.36,
          fontWeight: 700,
        }}
      >
        {slide.title}
      </div>
      <div
        style={{
          marginTop: 44,
          width: 96,
          height: 8,
          borderRadius: 4,
          background: palette.accent,
          transformOrigin: "left",
          transform: `scaleX(${line})`,
        }}
      />
      {slide.caption ? (
        <div
          style={{
            ...caption,
            marginTop: 30,
            color: palette.inkDim,
            fontSize: 32,
            lineHeight: 1.7,
          }}
        >
          {slide.caption}
        </div>
      ) : null}
    </Frame>
  );
};
