import { createContext, useContext, type CSSProperties } from "react";

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

export interface BodyConfig {
  /** 正文字号缩放比例 */
  scale: number;
  /** 正文水平偏移（画布 1080 宽下的像素） */
  offsetX: number;
  /** 正文垂直偏移（画布 1920 高下的像素） */
  offsetY: number;
  /** 正文宽度占文字区宽度的百分比 */
  width: number;
}

export interface LayoutConfig {
  mode: AvatarMode;
  avatar: AvatarConfig;
  /** 正文排版微调 */
  body: BodyConfig;
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
  body: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    width: 100,
  },
};

export const LayoutContext = createContext<LayoutConfig>(defaultLayout);

export const useLayout = () => useContext(LayoutContext);

export const bodyWrapStyle = (body?: Partial<BodyConfig>): CSSProperties => {
  const scale = Math.min(2, Math.max(0.5, Number(body?.scale) || 1));
  const offsetX = Math.min(540, Math.max(-540, Number(body?.offsetX) || 0));
  const offsetY = Math.min(960, Math.max(-960, Number(body?.offsetY) || 0));
  const width = Math.min(120, Math.max(40, Number(body?.width) || 100));
  return {
    width: `${width}%`,
    transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
    transformOrigin: "center top",
  };
};
