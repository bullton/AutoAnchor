import { usePop, useRise } from "../components/anim";
import { Frame } from "../components/Frame";
import { Kicker } from "../components/Kicker";
import { useStyle } from "../components/StyleContext";
import type { SlideData } from "../types";

export const BigNumberScene = ({ slide }: { slide: SlideData }) => {
  const { palette } = useStyle();
  const pop = usePop(4);
  const text = useRise(24, 22);

  return (
    <Frame>
      <Kicker text={slide.kicker} />
      <div
        style={{
          marginTop: 40,
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          whiteSpace: "nowrap",
          transform: `scale(${0.86 + pop * 0.14})`,
          transformOrigin: "left bottom",
        }}
      >
        <span style={{ color: palette.accent, fontSize: 300, fontWeight: 700, lineHeight: 1 }}>
          {slide.number}
        </span>
        <span style={{ color: palette.ink, fontSize: 76, fontWeight: 700 }}>
          {slide.unit}
        </span>
      </div>
      <div
        style={{
          ...text,
          marginTop: 44,
          color: palette.inkDim,
          fontSize: 44,
          lineHeight: 1.62,
        }}
      >
        {slide.title}
      </div>
    </Frame>
  );
};
