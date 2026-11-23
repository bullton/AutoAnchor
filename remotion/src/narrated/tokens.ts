export const WIDTH = 1080;
export const HEIGHT = 1920;

/** 顶部标题条高�?*/
export const TITLE_H = 640;

/** 照片带（标题条下方） */
export const BAND_TOP = TITLE_H;
export const PHOTO_H = 420;
export const BAND_H = BAND_TOP + PHOTO_H;

/** 底部字幕留白 */
export const SAFE_BOTTOM = 380;
export const SIDE = 66;

/** 正文垂直重心（画布中线）对应的顶部锚点 */
export const TEXT_ANCHOR = 668;

export const CONTENT_TOP = BAND_H;

/** 素材铺满高度：大图（横图）整屏铺底，竖图/小图占上半部 */
export const photoFillHeight = (aspect?: number | null, canvasH: number = HEIGHT): number => {
  if (aspect && aspect >= 1.15) return canvasH;
  if (aspect && aspect >= 0.9) return Math.round(canvasH * 0.7);
  return Math.round(canvasH * 0.62);
};
