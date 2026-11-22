import { useRise } from "../components/anim";
import { Frame } from "../components/Frame";
import { useStyle } from "../components/StyleContext";
import { titleSize } from "../theme";
import type { SlideData } from "../types";

export const ClosingScene = ({ slide }: { slide: SlideData }) => {
  const { palette } = useStyle();
  const mark = useRise(0, 20);
  const title = useRise(8, 40);
  const caption = useRise(20, 20);

  return (
    <Frame align="center" textAlign="center">
      <div style={{ ...mark, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 12, height: 12, borderRadius: 6, background: palette.accent }} />
        <span
          style={{
            color: palette.inkFaint,
            fontSize: 22,
            letterSpacing: "0.32em",
            fontWeight: 700,
          }}
        >
          END
        </span>
      </div>
      <div
        style={{
          ...title,
          marginTop: 36,
          color: palette.ink,
          fontSize: titleSize(slide.title),
          lineHeight: 1.4,
          fontWeight: 700,
        }}
      >
        {slide.title}
      </div>
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
