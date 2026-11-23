import { createContext, useContext } from "react";
import { getLook, getPalette, looks, palettes, type Look, type Palette, type StyleId } from "../theme";

export type MotionId = "light" | "standard" | "strong";

export interface MotionConfig {
  distance: number;
  wipe: number;
  rise: { stiffness: number; damping: number; mass: number };
  pop: { stiffness: number; damping: number; mass: number };
}

export const motions: Record<MotionId, MotionConfig> = {
  light: {
    distance: 0.72,
    wipe: 1.25,
    rise: { stiffness: 105, damping: 220, mass: 0.9 },
    pop: { stiffness: 90, damping: 20, mass: 0.8 },
  },
  standard: {
    distance: 1,
    wipe: 1,
    rise: { stiffness: 130, damping: 200, mass: 0.9 },
    pop: { stiffness: 110, damping: 14, mass: 0.7 },
  },
  strong: {
    distance: 1.28,
    wipe: 0.72,
    rise: { stiffness: 170, damping: 18, mass: 0.9 },
    pop: { stiffness: 150, damping: 9, mass: 0.65 },
  },
};

export const getMotion = (id?: string): MotionConfig =>
  motions[(id as MotionId) in motions ? (id as MotionId) : "standard"];

export interface StyleConfig {
  id: StyleId;
  palette: Palette;
  look: Look;
  motion: MotionConfig;
}

export const StyleContext = createContext<StyleConfig>({
  id: "amber",
  palette: palettes.amber,
  look: looks.amber,
  motion: motions.standard,
});

export const useStyle = () => useContext(StyleContext);

export const resolveStyle = (style?: { id?: string; motion?: string }): StyleConfig => ({
  id: (style?.id as StyleId) in palettes ? (style?.id as StyleId) : "amber",
  palette: getPalette(style?.id),
  look: getLook(style?.id),
  motion: getMotion(style?.motion),
});
