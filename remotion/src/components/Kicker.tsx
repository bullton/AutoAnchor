import { useStyle } from "./StyleContext";
import { useRise } from "./anim";

export const Kicker = ({ text, delay = 0 }: { text?: string; delay?: number }) => {
  const { palette } = useStyle();
  const rise = useRise(delay, 18);
  if (!text) return null;
  return (
    <div
      style={{
        ...rise,
        color: palette.accent,
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: "0.1em",
      }}
    >
      {text}
    </div>
  );
};
