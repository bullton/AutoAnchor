import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePaths } from "./private.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");

const outputRoot = process.env.OD_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.OD_OUTPUT_DIR)
  : path.join(ROOT, "output");

const local = privatePaths();

export const paths = {
  root: ROOT,
  input: path.join(ROOT, "input"),
  output: outputRoot,
  remotion: path.join(ROOT, "remotion"),
  python: local.python,
  voiceRef: local.voiceRef,
  models: local.modelsRoot,
  vendor: local.vendorRoot,
  ffmpeg: local.ffmpeg,
  ffprobe: local.ffprobe,
};

export const video = {
  width: 1080,
  height: 1920,
  fps: 30,
};

const AVATAR_MODES = new Set(["none", "image", "video"]);
const AVATAR_SHAPES = new Set(["rounded", "circle", "ellipse", "square", "diamond", "hexagon"]);
const AVATAR_FITS = new Set(["contain", "cover"]);
const AVATAR_MOTIONS = new Set(["none", "float", "breathe"]);

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export const shapeRatio = (shape, naturalAspect = 0.75) => {
  if (shape === "ellipse") return 1 / 1.22;
  if (shape === "hexagon") return 1 / 0.92;
  if (shape === "rounded") return clamp(naturalAspect, 0.2, 3, 0.75);
  return 1;
};

/** 兼容旧版（layout: full / avatar-bottom + avatarHeight）并归一化新布局配置 */
export function normalizeLayout(raw = {}) {
  const legacyBottom = raw.layout === "avatar-bottom";
  const mode = AVATAR_MODES.has(raw.mode)
    ? raw.mode
    : legacyBottom && raw.avatarVideo
      ? "video"
      : "none";
  const a = raw.avatar && typeof raw.avatar === "object" ? raw.avatar : {};
  const width = clamp(a.width, 0.1, 1, legacyBottom ? 0.62 : 0.34);
  const height = clamp(a.aspect, 0.2, 3, 0.75); // width / height
  return {
    mode,
    avatar: {
      src: typeof a.src === "string" ? a.src : (typeof raw.avatarVideo === "string" ? raw.avatarVideo : ""),
      width: Math.round(width * 1000) / 1000,
      x: clamp(a.x, 0, 1, 0.5),
      y: clamp(a.y, 0, 1, legacyBottom ? 0.8 : 0.76),
      aspect: Math.round(height * 1000) / 1000,
      shape: AVATAR_SHAPES.has(a.shape) ? a.shape : "rounded",
      fit: AVATAR_FITS.has(a.fit) ? a.fit : "contain",
      frame: a.frame !== false,
      motion: AVATAR_MOTIONS.has(a.motion) ? a.motion : "float",
      borderWidth: Math.round(clamp(a.borderWidth, 0, 32, 4)),
      borderColor: /^#[0-9a-fA-F]{6}$/.test(a.borderColor) ? a.borderColor : "#e8a33d",
    },
    avoid: raw.avoid !== false,
    gap: clamp(raw.gap, 0, 160, 24),
  };
}

export function readLayout() {
  const file = path.join(ROOT, "pipeline", "layout.json");
  let raw = {};
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  }
  return normalizeLayout(raw);
}

/** 头像在成片中的像素占位（左上角 + 宽高） */
export function avatarRect(layout, canvasW = video.width, canvasH = video.height) {
  const width = Math.min(canvasW, Math.max(120, layout.avatar.width * canvasW));
  const height = width / shapeRatio(layout.avatar.shape, layout.avatar.aspect);
  const cx = Math.min(canvasW, Math.max(0, layout.avatar.x * canvasW));
  const cy = Math.min(canvasH, Math.max(0, layout.avatar.y * canvasH));
  return {
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export const files = {
  script: path.join(paths.input, "script.txt"),
  slides: path.join(paths.output, "slides.json"),
  slidesTimed: path.join(paths.output, "props.json"),
  ttsDir: path.join(paths.output, "tts"),
  voice: path.join(paths.output, "voice.wav"),
  timeline: path.join(paths.output, "timeline.json"),
  subtitlesAss: path.join(paths.output, "subtitles.ass"),
  subtitlesSrt: path.join(paths.output, "subtitles.srt"),
  silentVideo: path.join(paths.output, "slides.mp4"),
  finalVideo: path.join(paths.output, "final.mp4"),
};
