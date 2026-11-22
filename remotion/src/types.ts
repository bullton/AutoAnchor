import type { LayoutConfig } from "./components/LayoutContext";
import type { SceneMotion } from "./narrated/sceneMotion";

export type SlideType = "title" | "bullets" | "quote" | "number" | "closing";

export interface SlideData {
  id: string;
  index: number;
  total: number;
  type: SlideType;
  kicker?: string;
  title: string;
  body?: string[];
  number?: string;
  unit?: string;
  caption?: string;
  speech?: string;
  durationInFrames: number;
}

export type SceneLayout =
  | "hero"
  | "band"
  | "number"
  | "bars"
  | "compare"
  | "list"
  | "abstract"
  | "closing";

export interface SceneCue {
  id: string;
  text: string;
  at: number;
  end: number;
}

export interface SceneLayoutStyle {
  preset?: "full" | "top" | "left";
  photoScale?: number;
  photoX?: number;
  photoY?: number;
  contentX?: number;
  contentY?: number;
  contentAlign?: "left" | "center" | "right";
}

export interface SceneData {
  id: string;
  index: number;
  total: number;
  kicker: string;
  barTitle?: string;
  tag?: string;
  layout: SceneLayout;
  title: string;
  bullets: string[];
  number?: string;
  unit?: string;
  emphasis?: string[];
  lines: string[];
  lineIds: string[];
  speech: string;
  photoKey?: string;
  photo?: string | null;
  photoSource?: string;
  layoutStyle?: SceneLayoutStyle | null;
  photoAspect?: number | null;
  photoFocus?: string;
  mood?: string;
  cues?: SceneCue[];
  audioStart?: number;
  audioEnd?: number;
  durationInFrames: number;
  motion?: SceneMotion | null;
}

export interface StyleProps {
  id?: string;
  motion?: string;
}

export interface VideoProps {
  slides: SlideData[];
  scenes?: SceneData[];
  layout: LayoutConfig;
  style?: StyleProps;
  meta?: {
    credits?: { key: string; author: string; license: string; source: string }[];
    seriesTitle?: string;
    seriesTagline?: string;
  };
}
