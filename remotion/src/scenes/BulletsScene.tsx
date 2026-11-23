import { useRise } from "../components/anim";
import { Frame } from "../components/Frame";
import { Kicker } from "../components/Kicker";
import { useStyle } from "../components/StyleContext";
import { titleSize } from "../theme";
import type { SlideData } from "../types";

const BulletRow = ({ index, text }: { index: number; text: string }) => {
  const { palette } = useStyle();
  const rise = useRise(18 + index * 8, 28);
  return (
    <div
      style={{
        ...rise,
        display: "flex",
        alignItems: "flex-start",
        gap: 26,
        width: "100%",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          width: 14,
          height: 14,
          borderRadius: 7,
          marginTop: 26,
          background: palette.accent,
        }}
      />
      <div
        style={{
          color: palette.ink,
          fontSize: 42,
          lineHeight: 1.65,
          fontWeight: 400,
        }}
      >
        {text}
      </div>
    </div>
  );
};

export const BulletsScene = ({ slide }: { slide: SlideData }) => {
  const { palette } = useStyle();
  const rows = slide.body ?? [];
  const title = useRise(6, 34);

  return (
    <Frame>
      <Kicker text={slide.kicker} />
      <div
        style={{
          ...title,
          marginTop: 26,
          color: palette.ink,
          fontSize: titleSize(slide.title),
          lineHeight: 1.36,
          fontWeight: 700,
        }}
      >
        {slide.title}
      </div>
      <div style={{ marginTop: 44, width: "100%", height: 1, background: palette.line }} />
      <div
        style={{
          marginTop: 48,
          display: "flex",
          flexDirection: "column",
          gap: 30,
          width: "100%",
        }}
      >
        {rows.map((row, i) => (
          <BulletRow key={i} index={i} text={row} />
        ))}
      </div>
    </Frame>
  );
};
