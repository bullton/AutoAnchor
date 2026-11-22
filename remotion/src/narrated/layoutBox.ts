import { useVideoConfig } from "remotion";
import { shapeAspect, useLayout, type LayoutConfig } from "../components/LayoutContext";
import { SAFE_BOTTOM, SIDE } from "./tokens";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SafeBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  contentBottom: number;
  width: number;
  height: number;
  scale: number;
  rect: Rect;
}

export const AVATAR_W = 1080;

export const computeSafeBox = (layout: LayoutConfig, canvasW: number, canvasH: number): SafeBox => {
  const avatar = layout.avatar;
  const hasAvatar = layout.mode !== "none" && Boolean(avatar && avatar.src);
  const width = Math.max(0, Math.min(canvasW, (Number(avatar?.width) || 0.34) * canvasW));
  const ratio = shapeAspect(avatar?.shape || "rounded", Number(avatar?.aspect) || 0.75);
  const height = width / ratio;
  const cx = Math.min(canvasW, Math.max(0, (Number(avatar?.x) || 0.5) * canvasW));
  const cy = Math.min(canvasH, Math.max(0, (Number(avatar?.y) || 0.76) * canvasH));
  const rect: Rect = { left: cx - width / 2, top: cy - height / 2, width, height };

  const box = { left: SIDE, right: SIDE, top: 0, bottom: SAFE_BOTTOM };
  let contentBottom = SAFE_BOTTOM;

  if (hasAvatar && layout.avoid !== false) {
    const gap = Math.max(0, Number(layout.gap) || 0);
    const offCenter = cx <= canvasW * 0.46 || cx >= canvasW * 0.54;
    const overlapsTextBand = rect.top < canvasH * 0.62 && rect.top + height > canvasH * 0.18;
    const sideBySide = width < canvasW * 0.56 && offCenter && overlapsTextBand;
    if (sideBySide) {
      if (cx <= canvasW * 0.46) box.left = Math.max(box.left, rect.left + width + gap);
      else box.right = Math.max(box.right, canvasW - rect.left + gap);
      contentBottom = Math.max(SAFE_BOTTOM, Math.round(canvasH - rect.top + gap));
    } else {
      if (cy <= canvasH * 0.5) box.top = Math.max(box.top, rect.top + height + gap);
      else box.bottom = Math.max(box.bottom, canvasH - rect.top + gap);
    }
    const maxInset = canvasW * 0.42;
    box.left = Math.min(box.left, maxInset);
    box.right = Math.min(box.right, maxInset);
  }
  contentBottom = Math.max(contentBottom, box.bottom);

  const usableW = Math.max(240, canvasW - box.left - box.right);
  const usableH = Math.max(240, canvasH - box.top - box.bottom);
  const scale = Math.min(1, Math.max(0.72, usableW / Math.max(1, canvasW - SIDE * 2)));

  return { ...box, contentBottom, width: usableW, height: usableH, scale, rect };
};

export const useSafeBox = (): SafeBox => {
  const layout = useLayout();
  const { width, height } = useVideoConfig();
  return computeSafeBox(layout, width, height);
};

/** 照片带高度：内容区被头像压缩时等比收缩 */
export const photoBandHeight = (box: SafeBox, base: number): number =>
  Math.round(Math.min(base, Math.max(220, box.height * 0.36)));
