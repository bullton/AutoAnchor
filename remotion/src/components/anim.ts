import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { useStyle } from "./StyleContext";

export const useRise = (delay = 0, distance = 44) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion } = useStyle();
  const value = spring({
    frame: frame - delay,
    fps,
    config: motion.rise,
  });
  const v = Math.min(1, Math.max(0, value));
  return {
    opacity: v,
    transform: `translateY(${(1 - v) * distance * motion.distance}px)`,
  };
};

export const useWipe = (delay = 0, duration = 14) => {
  const frame = useCurrentFrame();
  const { motion } = useStyle();
  return Math.min(1, Math.max(0, (frame - delay) / Math.max(1, duration * motion.wipe)));
};

export const usePop = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { motion } = useStyle();
  const value = spring({
    frame: frame - delay,
    fps,
    config: motion.pop,
  });
  return Math.max(0, value);
};
