import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { files, paths, readLayout, shapeRatio, video } from "./config.mjs";
import { readMotion, resolveMotionForScene } from "./motion.mjs";
import { fetchMissingPhotos } from "./photos.mjs";

const slidesFile = files.slides;
if (!fs.existsSync(slidesFile)) {
  console.error(`缺少 ${slidesFile}，请先生成分镜`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(slidesFile, "utf8"));
const uiFile = path.join(paths.root, "pipeline", "ui.json");
const ui = fs.existsSync(uiFile) ? JSON.parse(fs.readFileSync(uiFile, "utf8")) : {};
const fps = Number(video.fps) || 30;
const gap = Number(ui.gap ?? 0.26) || 0;
const styleId = ui.styleId || "amber";
const motionMode = ui.motion || "standard";
const motionConfig = readMotion();

const scriptHash =
  payload?.meta?.scriptHash ||
  (() => {
    const speech = (Array.isArray(payload?.slides) ? payload.slides : []).map((slide) => String(slide?.speech || "")).join("");
    if (!speech.trim()) return "";
    return crypto.createHash("sha1").update(speech.replace(/\s+/g, "")).digest("hex").slice(0, 16);
  })();

const photoDir = path.join(paths.root, "assets", "photos");
const photoOut = path.join(paths.remotion, "public", "photos");
const photoExts = [".jpg", ".jpeg", ".png", ".webp"];
const photoCache = new Map();

function resolvePhoto(key) {
  if (!key || key === "topic") return null;
  for (const ext of photoExts) {
    const src = path.join(photoDir, `${key}${ext}`);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(photoOut, { recursive: true });
    const name = `${key}${ext}`;
    fs.copyFileSync(src, path.join(photoOut, name));
    return `photos/${name}`;
  }
  return null;
}

function photoAspectOf(photo) {
  if (!photo || photoCache.has(photo)) return photo ? photoCache.get(photo) : null;
  let aspect = null;
  try {
    const file = path.join(photoOut, path.basename(photo));
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const [w, h] = out.split(",").map(Number);
    if (w > 0 && h > 0) aspect = Math.round((w / h) * 1000) / 1000;
  } catch {
    aspect = null;
  }
  photoCache.set(photo, aspect);
  return aspect;
}

const avatarDir = path.join(paths.root, "assets", "avatar");
const avatarOut = path.join(paths.remotion, "public", "avatar");
const avatarExts = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"];

function resolveAvatar(src) {
  if (!src) return null;
  if (path.isAbsolute(src) && fs.existsSync(src)) return src;
  const direct = path.join(paths.root, src);
  if (fs.existsSync(direct)) return direct;
  const base = path.basename(src);
  for (const dir of [avatarDir, paths.output]) {
    const candidate = path.join(dir, base);
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of avatarExts) {
    const candidate = path.join(avatarDir, `${base}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function previewLayout() {
  const layout = readLayout();
  if (layout.mode === "none") return layout;
  const found = resolveAvatar(layout.avatar.src);
  if (!found) return { ...layout, mode: "none" };
  fs.mkdirSync(avatarOut, { recursive: true });
  const name = path.basename(found);
  fs.copyFileSync(found, path.join(avatarOut, name));
  return { ...layout, avatar: { ...layout.avatar, src: `avatar/${name}` } };
}

const layout = previewLayout();
const rawSlides = Array.isArray(payload.slides) ? payload.slides : [];
const rawScenes = Array.isArray(payload.scenes) ? payload.scenes : [];
if (!rawSlides.length || !rawScenes.length) {
  console.error("分镜内容为空，无法预生成画面");
  process.exit(1);
}

const fetchRequests = [];
for (const scene of rawScenes) {
  const key = scene.photoKey;
  if (!key || key === "topic") continue;
  if (fetchRequests.some((item) => item.key === key)) continue;
  const exists = photoExts.some((ext) => fs.existsSync(path.join(photoDir, `${key}${ext}`)));
  if (!exists) fetchRequests.push({ key, query: scene.photoQuery, wikiTitle: scene.wikiTitle });
}
if (fetchRequests.length) {
  console.log(`[01b] 预览补图：${fetchRequests.length} 张（${fetchRequests.map((item) => item.key).join(", ")}）`);
  try {
    const result = await fetchMissingPhotos(paths.root, fetchRequests, (line) =>
      console.log(String(line).replace(/^\[03\]/, "[01b]")),
    );
    if (result.failed.length) console.warn(`[01b] 补图失败 ${result.failed.length} 张：${result.failed.join(", ")}`);
  } catch (err) {
    console.warn(`[01b] 补图异常：${err?.message || err}`);
  }
}

function resolveSeriesTitle(meta, scenes) {
  const title = String(meta?.seriesTitle || "").trim();
  const first = String(scenes?.[0]?.title || "").trim();
  if (title && first && first.startsWith(title) && Array.from(first).length > Array.from(title).length) {
    return Array.from(first).slice(0, 18).join("");
  }
  return title;
}

let cursor = 0;
const timed = rawSlides.map((slide, index) => {
  const text = String(slide.speech || slide.title || "").replace(/\s/g, "");
  const duration = Math.max(1, text.length / 4.7) + (index < rawSlides.length - 1 ? gap : 0);
  const start = cursor;
  const end = cursor + duration;
  cursor = end;
  return {
    ...slide,
    audioStart: Number(start.toFixed(3)),
    audioEnd: Number(end.toFixed(3)),
    durationInFrames: Math.max(1, Math.round(end * fps) - Math.round(start * fps)),
  };
});

const timedById = new Map(timed.map((slide) => [slide.id, slide]));
let prevFrame = 0;
const scenes = rawScenes.map((scene, sceneIndex) => {
  const items = (scene.lineIds || []).map((id) => timedById.get(id)).filter(Boolean);
  const start = items[0]?.audioStart ?? prevFrame / fps;
  const end = items[items.length - 1]?.audioEnd ?? start;
  const frame = Math.round(end * fps);
  const durationInFrames = Math.max(1, frame - prevFrame);
  prevFrame = frame;
  const photo = resolvePhoto(scene.photoKey);
  return {
    ...scene,
    motion: resolveMotionForScene(motionConfig, sceneIndex),
    photo,
    photoAspect: photoAspectOf(photo),
    photoFocus: scene.layout === "hero" ? "center 42%" : "center 38%",
    audioStart: Number(start.toFixed(3)),
    audioEnd: Number(end.toFixed(3)),
    durationInFrames,
    cues: items.map((item) => ({
      id: item.id,
      text: item.speech,
      at: Number((item.audioStart - start).toFixed(3)),
      end: Number((item.audioEnd - start).toFixed(3)),
    })),
  };
});

const props = {
  meta: {
    ...(payload.meta || {}),
    seriesTitle: resolveSeriesTitle(payload.meta, rawScenes),
    totalSeconds: Number(cursor.toFixed(3)),
    provider: "preview",
    credits: [],
    scriptHash,
    previewStoryboard: true,
    estimatedTiming: true,
  },
  layout,
  style: { id: styleId, motion: motionMode },
  slides: timed,
  scenes,
};

fs.mkdirSync(path.dirname(files.slidesTimed), { recursive: true });
fs.writeFileSync(files.slidesTimed, JSON.stringify(props, null, 2), "utf8");
console.log(
  `[01b] 分镜预生成：${scenes.length} 幕 / ${timed.length} 句 / 约 ${cursor.toFixed(1)}s -> ${files.slidesTimed}`,
);
