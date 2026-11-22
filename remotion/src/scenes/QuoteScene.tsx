import { useRise, useWipe } from "../components/anim";
import { Frame } from "../components/Frame";
import { Kicker } from "../components/Kicker";
import { useStyle } from "../components/StyleContext";
import { titleSize } from "../theme";
import type { SlideData } from "../types";

export const QuoteScene = ({ slide }: { slide: SlideData }) => {
  const { palette } = useStyle();
  const bar = useWipe(6, 14);
  const text = useRise(10, 42);

  return (
    <Frame>
      <Kicker text={slide.kicker} />
      <div
        style={{
          marginTop: 34,
          display: "flex",
          gap: 34,
          alignItems: "stretch",
          width: "100%",
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            width: 8,
            borderRadius: 4,
            background: palette.accent,
            transformOrigin: "top",
            transform: `scaleY(${bar})`,
          }}
        />
        <div
          style={{
            ...text,
            color: palette.ink,
            fontSize: titleSize(slide.title),
            lineHeight: 1.46,
            fontWeight: 700,
          }}
        >
          {slide.title}
        </div>
      </div>
      {slide.caption ? (
        <div style={{ marginTop: 36, color: palette.inkDim, fontSize: 32, lineHeight: 1.7 }}>
          {slide.caption}
        </div>
      ) : null}
    </Frame>
  );
};
