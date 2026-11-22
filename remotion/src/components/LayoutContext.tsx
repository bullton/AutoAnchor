import { createContext, useContext } from "react";

export type AvatarMode = "none" | "image" | "video";
export type AvatarShape = "rounded" | "circle" | "ellipse" | "square" | "diamond" | "hexagon";
export type AvatarFit = "contain" | "cover";
export type AvatarMotion = "none" | "float" | "breathe";

export interface AvatarConfig {
  src: string;
  /** 头像宽度占画布宽度的比例（0.1 – 1） */
  width: number;
  /** 中心点位置，0 – 1 */
  x: number;
  y: number;
  /** 圆角形状下的原始宽 / 高 */
  aspect: number;
  shape: AvatarShape;
  fit: AvatarFit;
  /** 投影开关 */
  frame: boolean;
  motion: AvatarMotion;
  /** 描边粗细（画布 1080 宽下的像素） */
  borderWidth: number;
  borderColor: string;
}

export interface LayoutConfig {
  mode: AvatarMode;
  avatar: AvatarConfig;
  /** 文字、图片、字幕是否避让头像占位 */
  avoid: boolean;
  /** 避让间距（px） */
  gap: number;
}

export const AVATAR_CLIP: Record<string, string | undefined> = {
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
};

/** 形状对应的外框宽高比（宽 / 高） */
export const shapeAspect = (shape: string, naturalAspect = 0.75): number => {
  if (shape === "ellipse") return 1 / 1.22;
  if (shape === "hexagon") return 1 / 0.92;
  if (shape === "rounded") return Math.min(3, Math.max(0.2, naturalAspect || 0.75));
  return 1;
};

export const defaultLayout: LayoutConfig = {
  mode: "none",
  avatar: {
    src: "",
    width: 0.34,
    x: 0.5,
    y: 0.76,
    aspect: 0.75,
    shape: "rounded",
    fit: "contain",
    frame: true,
    motion: "float",
    borderWidth: 4,
    borderColor: "#e8a33d",
  },
  avoid: true,
  gap: 24,
};

export const LayoutContext = createContext<LayoutConfig>(defaultLayout);

export const useLayout = () => useContext(LayoutContext);
