import { interpolate } from "remotion";

export const fadeSlideUp = (frame: number, start: number, duration = 20, distance = 34) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  transform: `translateY(${interpolate(frame, [start, start + duration + 5], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })}px)`,
});

export const fadeSlideLeft = (frame: number, start: number, duration = 20, distance = 46) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  transform: `translateX(${interpolate(frame, [start, start + duration + 6], [-distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })}px)`,
});

export const fadeSlideRight = (frame: number, start: number, duration = 20, distance = 46) => ({
  opacity: interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }),
  transform: `translateX(${interpolate(frame, [start, start + duration + 6], [distance, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })}px)`,
});

export const fadeIn = (frame: number, start: number, duration = 18) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const fadeOutOf = (frame: number, start: number, duration = 14) =>
  interpolate(frame, [start, start + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const countUp = (
  frame: number,
  target: number,
  start: number,
  duration: number,
  decimals = 0,
) => {
  const v =
    target *
    interpolate(frame, [start, start + duration], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return v.toFixed(decimals);
};

export const progress = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const slowKen = (frame: number, duration: number, from = 1.0, to = 1.05) =>
  `scale(${interpolate(frame, [0, Math.max(1, duration)], [from, to], {
    extrapolateRight: "clamp",
  })})`;

/** 结构块先占位、按台词提亮 */
export const cue = (appear: number, base = 0.26) => base + appear * (1 - base);
