import type { SceneData, SceneLayoutStyle } from "../types";
import type { SafeBox } from "./layoutBox";
import { SAFE_BOTTOM, WIDTH } from "./tokens";

export type ScenePreset = "full" | "top" | "left";

export const SCENE_STYLE_DEFAULTS: Record<
  ScenePreset,
  Required<Pick<SceneLayoutStyle, "photoScale" | "photoX" | "photoY" | "contentX" | "contentY" | "contentAlign">>
> = {
  full: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 75, contentAlign: "left" },
  top: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" },
  left: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" },
};

const numOr = (value: number | undefined, fallback: number, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const isMaterialScene = (scene: SceneData) =>
  Boolean(scene && scene.photoSource === "material" && scene.layout !== "closing");

export const normalizeSceneStyle = (raw?: SceneLayoutStyle | null, preset: ScenePreset = "full") => {
  const p: ScenePreset = raw?.preset === "top" || raw?.preset === "left" ? raw.preset : preset;
  const base = SCENE_STYLE_DEFAULTS[p];
  const align = raw?.contentAlign;
  return {
    preset: p,
    photoScale: Math.round(numOr(raw?.photoScale, base.photoScale, 1, 1.8) * 100) / 100,
    photoX: Math.round(numOr(raw?.photoX, base.photoX, 0, 100)),
    photoY: Math.round(numOr(raw?.photoY, base.photoY, 0, 100)),
    contentX: Math.round(numOr(raw?.contentX, base.contentX, 0, 100)),
    contentY: Math.round(numOr(raw?.contentY, base.contentY, 0, 100)),
    contentAlign: align === "center" || align === "right" ? align : "left",
  };
};

export interface SceneContentGeometry {
  preset: ScenePreset;
  style: ReturnType<typeof normalizeSceneStyle>;
  contentTop: number;
  contentLeft: number;
  contentWidth: number;
  contentAlign: "left" | "center" | "right";
}

/** 与 app.js 预览 previewSceneHtml 使用同一套正文定位公式 */
export const sceneContentGeometry = (
  scene: SceneData,
  box: SafeBox,
  canvasH: number,
): SceneContentGeometry => {
  const material = isMaterialScene(scene);
  const style = normalizeSceneStyle(scene.layoutStyle, "full");
  const preset: ScenePreset = material ? style.preset : "full";
  const contentBottomInset = Math.max(SAFE_BOTTOM, box.bottom);
  const contentMinTop = material ? (preset === "full" ? 600 : preset === "top" ? 980 : 660) : 668;
  const contentMaxTop = Math.max(contentMinTop, canvasH - contentBottomInset - 200);
  const contentTop = contentMinTop + (style.contentY / 100) * (contentMaxTop - contentMinTop);
  const baseLeft = preset === "left" ? 620 : box.left;
  const baseWidth = preset === "left" ? WIDTH - box.right - 620 : WIDTH - box.left - box.right;
  const shift = Math.round((style.contentX / 100) * Math.min(180, baseWidth * 0.22));
  const contentLeft = baseLeft + shift;
  const contentWidth = Math.max(240, baseWidth - shift);
  return {
    preset,
    style,
    contentTop,
    contentLeft,
    contentWidth,
    contentAlign: style.contentAlign,
  };
};
