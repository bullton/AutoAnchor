import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, execFile, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PRIVATE_FILE,
  chromeCandidates,
  mergeTtsConfig,
  maskedPrivate,
  privateAi,
  privatePaths,
  readPrivate,
  setupState,
  venvPython,
  writePrivate,
} from "./pipeline/private.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = process.env.OD_PIPELINE_ROOT ? path.resolve(process.env.OD_PIPELINE_ROOT) : HERE;
const motionLib = await import(pathToFileURL(path.join(PIPELINE_ROOT, "pipeline", "motion.mjs")).href);
const HOST = process.env.OD_UI_HOST || "127.0.0.1";
const PORT = Number(process.env.OD_UI_PORT || 4310);

const RUNS_DIR = path.join(PIPELINE_ROOT, "output", "runs");
const TTS_CONFIG = path.join(PIPELINE_ROOT, "pipeline", "tts", "config.json");
const UI_CONFIG = path.join(PIPELINE_ROOT, "pipeline", "ui.json");
const AI_CONFIG = process.env.OD_AI_CONFIG || path.join(PIPELINE_ROOT, "pipeline", "ai.json");
const LAYOUT_CONFIG = path.join(PIPELINE_ROOT, "pipeline", "layout.json");
const SCRIPT_FILE = path.join(PIPELINE_ROOT, "input", "script.txt");
const SERIES_FILE = path.join(PIPELINE_ROOT, "input", "series.json");
const VOICE_DIR = privatePaths().voiceRef || path.join(PIPELINE_ROOT, "assets", "voice-ref");
const AVATAR_DIR = path.join(PIPELINE_ROOT, "assets", "avatar");
const MATERIAL_DIR = path.join(PIPELINE_ROOT, "assets", "materials");
const MATERIAL_FILE = path.join(MATERIAL_DIR, "manifest.json");
const PHOTO_DIR = path.join(PIPELINE_ROOT, "assets", "photos");
const PRESET_FILE = path.join(PIPELINE_ROOT, "pipeline", "layout-presets.json");
const PROPS_FILE = path.join(PIPELINE_ROOT, "output", "props.json");
const SLIDES_FILE = path.join(PIPELINE_ROOT, "output", "slides.json");
const PHOTO_OVERRIDE_FILE = path.join(PIPELINE_ROOT, "pipeline", "photo-overrides.json");
const SCENE_LAYOUT_FILE = path.join(PIPELINE_ROOT, "pipeline", "scene-layouts.json");
const LAYOUT_TEMPLATE_FILE = path.join(PIPELINE_ROOT, "pipeline", "layout-templates.json");
const PREVIEW_DIR = path.join(PIPELINE_ROOT, "output", "previews");
const REMOTION_DIR = path.join(PIPELINE_ROOT, "remotion");
const REMOTION_BIN = path.join(
  REMOTION_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "remotion.cmd" : "remotion",
);
const PYTHON = privatePaths().python;
const MAX_VOICE_BYTES = 40 * 1024 * 1024;
const VOICE_EXTS = new Set([".wav", ".mp3", ".m4a", ".flac"]);
const MAX_AVATAR_BYTES = 120 * 1024 * 1024;
const AVATAR_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"]);
const MAX_MATERIAL_BYTES = 40 * 1024 * 1024;
const MATERIAL_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const LAYOUT_MODES = new Set(["none", "image", "video"]);
const AVATAR_SHAPES = new Set(["rounded", "circle", "ellipse", "square", "diamond", "hexagon"]);
const AVATAR_FITS = new Set(["contain", "cover"]);
const DH_VARIANTS = new Set(["closeup", "fullbody", "auto"]);
const DH_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);
const AVATAR_MOTIONS = new Set(["none", "float", "breathe"]);

const clampNum = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

function normalizeLayoutConfig(raw = {}) {
  const legacyBottom = raw.layout === "avatar-bottom";
  const mode = LAYOUT_MODES.has(raw.mode) ? raw.mode : legacyBottom ? "video" : "none";
  const a = raw.avatar && typeof raw.avatar === "object" ? raw.avatar : {};
  const width = clampNum(a.width, 0.1, 1, legacyBottom ? 0.62 : 0.34);
  return {
    mode,
    avatar: {
      src: typeof a.src === "string" ? a.src.slice(0, 400) : "",
      width: Math.round(width * 1000) / 1000,
      x: clampNum(a.x, 0, 1, 0.5),
      y: clampNum(a.y, 0, 1, legacyBottom ? 0.8 : 0.76),
      aspect: Math.round(clampNum(a.aspect, 0.2, 3, 0.75) * 1000) / 1000,
      shape: AVATAR_SHAPES.has(a.shape) ? a.shape : "rounded",
      fit: AVATAR_FITS.has(a.fit) ? a.fit : "contain",
      frame: a.frame !== false,
      motion: AVATAR_MOTIONS.has(a.motion) ? a.motion : "float",
      borderWidth: Math.round(clampNum(a.borderWidth, 0, 32, 4)),
      borderColor: /^#[0-9a-fA-F]{6}$/.test(a.borderColor) ? a.borderColor : "#e8a33d",
    },
    avoid: raw.avoid !== false,
    gap: clampNum(raw.gap, 0, 160, 24),
  };
}

function normalizeDigitalHuman(raw = {}, layout = {}) {
  const value = raw && typeof raw === "object" ? raw : {};
  const fallbackRef = layout?.mode === "video" ? layout?.avatar?.src || "" : "";
  return {
    enabled: value.enabled === true,
    reference: String(value.reference || fallbackRef || "").trim().slice(0, 400),
    variant: DH_VARIANTS.has(value.variant) ? value.variant : "closeup",
    maxSide: Math.round(clampNum(value.maxSide, 480, 2160, 1440)),
    timeoutMin: Math.round(clampNum(value.timeoutMin, 10, 360, 120)),
    cropPct: /^\d{1,3}:\d{1,3}:\d{1,3}:\d{1,3}$/.test(String(value.cropPct || "")) ? String(value.cropPct) : "",
  };
}

const avatarSrc = (name) => `assets/avatar/${name}`;

function listAvatars() {
  try {
    return fs
      .readdirSync(AVATAR_DIR)
      .filter((name) => AVATAR_EXTS.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const stat = fs.statSync(path.join(AVATAR_DIR, name));
        return { name, src: avatarSrc(name), size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

function readMaterialManifest() {
  const data = readJson(MATERIAL_FILE, null);
  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .filter((item) => item && typeof item.key === "string" && typeof item.file === "string")
    .map((item) => ({
      id: String(item.id || item.key),
      key: item.key,
      file: path.basename(item.file),
      name: String(item.name || item.file),
      chapter: String(item.chapter || "未分章").trim() || "未分章",
      size: Number(item.size) || 0,
      mtime: Number(item.mtime) || 0,
      createdAt: Number(item.createdAt) || 0,
    }));
}

function writeMaterialManifest(items) {
  writeJson(MATERIAL_FILE, {
    version: 1,
    updatedAt: Date.now(),
    items: items.map((item, index) => ({ ...item, order: index })),
  });
}

function materialsHash() {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(MATERIAL_FILE)).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

function chapterNamesFromScript() {
  const names = [];
  try {
    const text = fs.readFileSync(SCRIPT_FILE, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const clean = line.trim().replace(/^#+\s*/, "");
      if (!clean || clean.length > 24 || /[。！？!?；;]/.test(clean)) continue;
      const chapter = clean.match(/^(?:第[一二三四五六七八九十百]+[章节篇]\s*)?(.{2,12}(?:篇|章|节))$/);
      if (chapter) names.push(chapter[1].trim());
    }
  } catch {}
  return names;
}

function knownMaterialChapters(includeManifest = true) {
  const names = [];
  const props = readJson(PROPS_FILE, null);
  for (const scene of props?.scenes || []) {
    const chapter = String(scene.chapter || "").trim();
    if (chapter && chapter !== "未分章") names.push(chapter);
    const bar = String(scene.barTitle || "").trim();
    if (bar && !["开场", "行动建议", "专题", "收尾", "结尾"].includes(bar)) names.push(bar);
  }
  if (includeManifest) for (const item of readMaterialManifest()) names.push(item.chapter);
  names.push(...chapterNamesFromScript());
  return [...new Set(names.filter((name) => name && name !== "未分章"))];
}

function materialChapterAliases(name) {
  const clean = String(name || "").trim();
  const base = clean.replace(/[篇章节]$/u, "");
  return [...new Set([clean, base].filter((item) => item.length >= 2))].sort((a, b) => b.length - a.length);
}

function detectMaterialChapter(name, known = knownMaterialChapters()) {
  const base = path.basename(String(name || ""), path.extname(String(name || "")));
  const clean = base.replace(/^[#\s]+/, "").trim();
  for (const chapter of [...known].sort((a, b) => b.length - a.length)) {
    if (chapter && materialChapterAliases(chapter).some((alias) => clean.includes(alias))) return chapter;
  }
  const suffix = clean.match(/[\u4e00-\u9fa5]{2,12}(?:篇|章|节)/u);
  return suffix ? suffix[0] : "未分章";
}

function publicMaterial(item) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    chapter: item.chapter,
    size: item.size,
    mtime: item.mtime,
    file: item.file,
    src: `/media/materials/${encodeURIComponent(item.file)}`,
  };
}

function listMaterials() {
  const items = readMaterialManifest()
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const chapters = [];
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(item.chapter)) {
      const entry = { name: item.chapter, count: 0, items: [] };
      seen.set(item.chapter, entry);
      chapters.push(entry);
    }
    const entry = seen.get(item.chapter);
    entry.count += 1;
    entry.items.push(publicMaterial(item));
  }
  return { items: items.map(publicMaterial), chapters, chapterOptions: knownMaterialChapters(), hash: materialsHash() };
}

function removeMaterialFiles(item) {
  for (const dir of [MATERIAL_DIR, PHOTO_DIR]) {
    for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
      try {
        fs.rmSync(path.join(dir, `${item.key}${ext}`), { force: true });
      } catch {}
    }
    try {
      fs.rmSync(path.join(dir, item.file), { force: true });
    } catch {}
  }
}


function readPresets() {
  const data = readJson(PRESET_FILE, []);
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && typeof item.id === "string" && item.config)
    .map((item) => ({
      id: String(item.id).slice(0, 60),
      name: String(item.name || "未命名预设").slice(0, 40),
      createdAt: Number(item.createdAt) || null,
      config: normalizeLayoutConfig(item.config),
    }));
}

function writePresets(list) {
  writeJson(PRESET_FILE, list.slice(0, 40));
}

function resolvePhotoAsset(key) {
  const clean = String(key || "").trim();
  if (!clean || clean === "topic") return null;
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    const src = path.join(PHOTO_DIR, `${clean}${ext}`);
    if (!fileOk(src, 2)) continue;
    const name = `${clean}${ext}`;
    try {
      fs.mkdirSync(path.join(REMOTION_DIR, "public", "photos"), { recursive: true });
      fs.copyFileSync(src, path.join(REMOTION_DIR, "public", "photos", name));
    } catch {}
    return { photo: `photos/${name}`, file: src };
  }
  return null;
}

function probeImageAspect(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file],
      { encoding: "utf8", timeout: 15000, windowsHide: true },
    ).trim();
    const [w, h] = out.split(",").map(Number);
    return w > 0 && h > 0 ? Math.round((w / h) * 1000) / 1000 : null;
  } catch {
    return null;
  }
}

async function restoreSceneNetwork(scene) {
  const key = String(scene.networkPhotoKey || "").trim();
  if (!key) throw new Error("这一幕没有保存网络配图，请先更新一次分镜");
  let asset = resolvePhotoAsset(key);
  if (!asset && key !== "topic") {
    try {
      const photos = await import(pathToFileURL(path.join(PIPELINE_ROOT, "pipeline", "photos.mjs")).href);
      await photos.fetchMissingPhotos(
        PIPELINE_ROOT,
        [{ key, query: scene.networkPhotoQuery || key.replace(/-/g, " "), wikiTitle: scene.networkWikiTitle || "" }],
        () => {},
      );
      asset = resolvePhotoAsset(key);
    } catch {}
  }
  scene.photoKey = key;
  scene.photoQuery = scene.networkPhotoQuery || "";
  scene.wikiTitle = scene.networkWikiTitle || "";
  scene.chapter = "";
  scene.materialName = "";
  scene.photoSource = "network";
  scene.photo = asset?.photo || null;
  scene.photoAspect = asset ? probeImageAspect(asset.file) : null;
  return scene;
}

function restoreSceneMaterial(scene, previous) {
  const key = String(previous?.photoKey || "").trim();
  if (!key) throw new Error("没有可恢复的素材图");
  const asset = resolvePhotoAsset(key);
  scene.photoKey = key;
  scene.photoQuery = previous.photoQuery || "";
  scene.wikiTitle = previous.wikiTitle || "";
  scene.chapter = previous.chapter || "";
  scene.materialName = previous.materialName || "";
  scene.photoSource = "material";
  scene.photo = asset?.photo || null;
  scene.photoAspect = asset ? probeImageAspect(asset.file) : null;
  return scene;
}

function syncSlidesPhoto(scene) {
  const slides = readJson(SLIDES_FILE, null);
  const slideScene = (slides?.scenes || []).find((item) => String(item.id || "") === String(scene.id || ""));
  if (!slideScene) return;
  slideScene.photoKey = scene.photoKey;
  slideScene.photoQuery = scene.photoQuery;
  slideScene.wikiTitle = scene.wikiTitle;
  slideScene.chapter = scene.chapter;
  slideScene.materialName = scene.materialName;
  slideScene.photoSource = scene.photoSource;
  writeJson(SLIDES_FILE, slides);
}

async function setScenePhotoSource(sceneId, source) {
  if (source !== "network" && source !== "material") throw new Error("暂不支持这个图片来源");
  const props = readJson(PROPS_FILE, null);
  const propScenes = Array.isArray(props?.scenes) ? props.scenes : [];
  const propScene = propScenes.find((scene) => String(scene.id || "") === String(sceneId || ""));
  if (!propScene) throw new Error("找不到这一幕，请先更新分镜");
  const scriptHash = String(props?.meta?.scriptHash || "");
  if (!scriptHash) throw new Error("分镜版本信息缺失，请先更新分镜");
  const saved = readJson(PHOTO_OVERRIDE_FILE, null);
  const overrides = saved?.scriptHash === scriptHash && saved.scenes && typeof saved.scenes === "object" ? saved : { scriptHash, scenes: {} };
  overrides.scriptHash = scriptHash;
  const existing = overrides.scenes[propScene.id] || {};

  if (source === "network") {
    const previous = existing.previous || {
      chapter: propScene.chapter || "",
      materialName: propScene.materialName || "",
      photoKey: propScene.photoKey || "",
      photoQuery: propScene.photoQuery || "",
      wikiTitle: propScene.wikiTitle || "",
    };
    await restoreSceneNetwork(propScene);
    overrides.scenes[propScene.id] = { source: "network", previous };
  } else {
    if (!existing.previous) throw new Error("没有可恢复的素材图");
    restoreSceneMaterial(propScene, existing.previous);
    overrides.scenes[propScene.id] = { source: "material", previous: existing.previous };
  }

  writeJson(PROPS_FILE, props);
  syncSlidesPhoto(propScene);
  writeJson(PHOTO_OVERRIDE_FILE, overrides);
  return propScene;
}

const SCENE_PRESETS = new Set(["full", "top", "left"]);
const SCENE_ALIGNS = new Set(["left", "center", "right"]);

function sceneLayoutDefaults(preset = "full") {
  return {
    photoScale: 1,
    photoX: 50,
    photoY: 42,
    contentX: 0,
    contentY: preset === "full" ? 75 : 0,
    contentAlign: "left",
  };
}

function normalizeSceneLayout(raw = {}) {
  const preset = SCENE_PRESETS.has(raw.preset) ? raw.preset : "full";
  const base = sceneLayoutDefaults(preset);
  return {
    preset,
    photoScale: Math.round(clampNum(raw.photoScale, 1, 1.8, base.photoScale) * 100) / 100,
    photoX: Math.round(clampNum(raw.photoX, 0, 100, base.photoX)),
    photoY: Math.round(clampNum(raw.photoY, 0, 100, base.photoY)),
    contentX: Math.round(clampNum(raw.contentX, 0, 100, base.contentX)),
    contentY: Math.round(clampNum(raw.contentY, 0, 100, base.contentY)),
    contentAlign: SCENE_ALIGNS.has(raw.contentAlign) ? raw.contentAlign : base.contentAlign,
  };
}

function sceneLayoutKey(scene = {}) {
  const chapter = String(scene.chapter || "").trim();
  if (chapter && chapter !== "未分章") return `chapter:${chapter}`;
  return `scene:${scene.id || ""}`;
}

function readSceneLayouts(scriptHash) {
  const saved = readJson(SCENE_LAYOUT_FILE, null);
  if (!saved || saved.scriptHash !== scriptHash || !saved.layouts || typeof saved.layouts !== "object") {
    return { version: 1, scriptHash, layouts: {} };
  }
  return { version: 1, scriptHash, layouts: saved.layouts };
}

function applySceneLayoutsToProps(props) {
  if (!props || !Array.isArray(props.scenes)) return props;
  const data = readSceneLayouts(props.meta?.scriptHash || "");
  for (const scene of props.scenes) {
    const layout = data.layouts[sceneLayoutKey(scene)];
    scene.layoutStyle = layout ? normalizeSceneLayout(layout) : null;
  }
  return props;
}

function setSceneLayout(sceneId, rawStyle) {
  const props = readJson(PROPS_FILE, null);
  if (!props || !Array.isArray(props.scenes)) throw new Error("还没有分镜，先生成一次分镜");
  const scene = props.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("没有找到这一幕");
  const style = normalizeSceneLayout(rawStyle || {});
  const scriptHash = props.meta?.scriptHash || "";
  const data = readSceneLayouts(scriptHash);
  data.layouts[sceneLayoutKey(scene)] = style;
  writeJson(SCENE_LAYOUT_FILE, data);
  applySceneLayoutsToProps(props);
  writeJson(PROPS_FILE, props);
  return { scene, style, key: sceneLayoutKey(scene) };
}

function readLayoutTemplates() {
  const saved = readJson(LAYOUT_TEMPLATE_FILE, null);
  const list = Array.isArray(saved?.templates) ? saved.templates : [];
  return list
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      name: String(item.name || "未命名模板").slice(0, 40),
      style: normalizeSceneLayout(item.style || {}),
      createdAt: Number(item.createdAt) || 0,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function writeLayoutTemplates(templates) {
  writeJson(LAYOUT_TEMPLATE_FILE, {
    version: 1,
    templates: templates.slice(0, 60).map((item) => ({
      id: item.id,
      name: item.name,
      style: item.style,
      createdAt: item.createdAt,
    })),
  });
}

function saveLayoutTemplate(body = {}) {
  const name = String(body.name || "").trim().slice(0, 40);
  if (!name) throw new Error("先给模板起个名字");
  const templates = readLayoutTemplates();
  const style = normalizeSceneLayout(body.style || body.layoutStyle || {});
  const item = {
    id: `tpl-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`,
    name,
    style,
    createdAt: Date.now(),
  };
  templates.unshift(item);
  writeLayoutTemplates(templates);
  return { template: item, templates: readLayoutTemplates() };
}

function deleteLayoutTemplate(id) {
  const clean = String(id || "");
  const templates = readLayoutTemplates().filter((item) => item.id !== clean);
  writeLayoutTemplates(templates);
  return templates;
}

function applyLayoutTemplate(id, sceneId) {
  const template = readLayoutTemplates().find((item) => item.id === String(id || ""));
  if (!template) throw new Error("模板不存在");
  const result = setSceneLayout(String(sceneId || ""), template.style);
  return { template, ...result };
}

function sceneList() {
  const props = readJson(PROPS_FILE, null);
  const config = motionLib.readMotion();
  const scenes = Array.isArray(props?.scenes) ? props.scenes : [];
  const savedOverrides = readJson(PHOTO_OVERRIDE_FILE, null);
  const overrides =
    savedOverrides?.scriptHash === props?.meta?.scriptHash && savedOverrides.scenes && typeof savedOverrides.scenes === "object"
      ? savedOverrides.scenes
      : {};
  const sceneLayouts = readSceneLayouts(props?.meta?.scriptHash || "");
  return scenes.map((scene, index) => {
    const recipe = motionLib.resolveMotionForScene(config, index);
    const override = overrides[scene.id] || null;
    const savedLayout = sceneLayouts.layouts[sceneLayoutKey(scene)];
    return {
      index,
      id: scene.id,
      title: scene.title || "",
      barTitle: scene.barTitle || "",
      bullets: Array.isArray(scene.bullets) ? scene.bullets : [],
      layout: scene.layout || "band",
      kicker: scene.kicker || `${String(index + 1).padStart(2, "0")}`,
      chapter: scene.chapter || "",
      materialName: scene.materialName || "",
      photoKey: scene.photoKey || "",
      photo: scene.photo || null,
      photoSource: scene.photoSource || (scene.materialName ? "material" : "network"),
      networkPhotoKey: scene.networkPhotoKey || "",
      canRestoreNetwork: Boolean(scene.networkPhotoKey) && Boolean(scene.materialName || scene.photoSource === "material"),
      canRestoreMaterial: override?.source === "network" && Boolean(override.previous?.photoKey),
      durationInFrames: Number(scene.durationInFrames) || 0,
      layoutStyle: scene.layoutStyle || (savedLayout ? normalizeSceneLayout(savedLayout) : null),
      motion: recipe ? { id: recipe.id, name: recipe.name } : null,
      locked: Boolean(config.locks?.[String(index)]),
    };
  });
}

function motionState() {
  hydrateGlobalFromLatestRun();
  const status = storyboardStatus();
  const props = readJson(PROPS_FILE, null);
  return {
    config: motionLib.readMotion(),
    scenes: sceneList(),
    presets: motionLib.PRESET_RECIPES,
    storyboard: status,
    planStale: status.planStale,
    meta: {
      seriesTitle: props?.meta?.seriesTitle || "",
      seriesTagline: props?.meta?.seriesTagline || "",
    },
    layout: normalizeLayoutConfig(readJson(LAYOUT_CONFIG, {})),
    templates: readLayoutTemplates(),
  };
}

function applyMotion(body = {}) {
  const status = requireFreshStoryboard();
  const config = motionLib.readMotion();
  const id = String(body.id || "").slice(0, 60);
  if (id && id !== "none" && !config.recipes[id]) {
    const preset = motionLib.PRESET_RECIPES.find((item) => item.id === id);
    if (!preset) throw new Error("动效配方不存在");
    config.recipes[id] = motionLib.normalizeRecipe(preset);
  }
  if (body.scope === "all") {
    const locked = config.locks || {};
    const kept = {};
    for (const [key, value] of Object.entries(config.assignments || {})) {
      if (key !== "default" && locked[key] && value) kept[key] = value;
    }
    config.assignments = { ...kept, default: id };
  } else {
    const index = Math.max(0, Math.round(Number(body.sceneIndex) || 0));
    if (config.locks?.[String(index)] && id && id !== "none" && id !== config.assignments[String(index)]) {
      throw new Error("本幕已锁定，先解锁再重排");
    }
    if (id && id !== "none") config.assignments[String(index)] = id;
    else delete config.assignments[String(index)];
  }
  if (Object.keys(config.assignments || {}).length) {
    config.source = { scriptHash: status.currentHash, sceneIds: status.sceneIds, at: Date.now() };
  }
  motionLib.writeMotion(config);
  return motionState();
}

function resetMotion(body = {}) {
  const config = motionLib.readMotion();
  if (body.scope === "all") {
    const locked = config.locks || {};
    const kept = {};
    for (const [key, value] of Object.entries(config.assignments || {})) {
      if (key !== "default" && locked[key] && value) kept[key] = value;
    }
    config.assignments = kept;
  } else {
    delete config.assignments[String(Math.max(0, Math.round(Number(body.sceneIndex) || 0)))];
  }
  motionLib.writeMotion(config);
  return motionState();
}

function sceneDigest(scenes) {
  return scenes.map((scene, index) => ({
    index,
    title: scene.title || scene.barTitle || "",
    barTitle: scene.barTitle || "",
    layout: scene.layout || "band",
    mood: scene.mood || "",
    number: scene.number || "",
    unit: scene.unit || "",
    bullets: Array.isArray(scene.bullets) ? scene.bullets.filter((item) => typeof item === "string").slice(0, 4) : [],
    speech: String(
      Array.isArray(scene.speech) ? scene.speech.join(" ") : scene.speech || (scene.lines || []).join(" ") || "",
    ).slice(0, 200),
  }));
}

async function autoMotionAction(body = {}) {
  const status = requireFreshStoryboard({ allowPlanStale: true });
  const props = readJson(PROPS_FILE, null);
  const scenes = Array.isArray(props?.scenes) ? props.scenes : [];
  if (!scenes.length) throw new Error("还没有分镜，先运行一次生成流程");
  const config = motionLib.readMotion();
  if (status.sceneIdsChanged || status.planStale) config.locks = {};
  const hint = String(body.prompt || "").slice(0, 200);
  const result = await motionLib.autoMotion({ scenes: sceneDigest(scenes), hint });
  if (!result.ok) throw new Error(result.reason || "自动编排失败");

  const locks = config.locks || {};
  const assignments = {};
  const keep = new Set();
  for (const [key, value] of Object.entries(config.assignments)) {
    if (key !== "default" && locks[key] && value) {
      assignments[key] = value;
      keep.add(value);
    }
  }
  result.recipes.forEach((recipe, index) => {
    if (locks[String(index)]) return;
    config.recipes[recipe.id] = recipe;
    assignments[String(index)] = recipe.id;
    keep.add(recipe.id);
  });
  config.assignments = assignments;
  config.source = { scriptHash: status.currentHash, sceneIds: status.sceneIds, at: Date.now() };
  config.auto = {
    theme: result.theme,
    summary: result.summary,
    hint,
    model: result.model || null,
    fallback: Boolean(result.fallback),
    at: Date.now(),
  };
  for (const id of Object.keys(config.recipes)) {
    if (!keep.has(id)) delete config.recipes[id];
  }
  motionLib.writeMotion(config);
  return {
    ...motionState(),
    theme: result.theme,
    summary: result.summary,
    fallback: Boolean(result.fallback),
    model: result.model || null,
    reason: result.reason || null,
  };
}

function lockMotion(body = {}) {
  requireFreshStoryboard();
  const config = motionLib.readMotion();
  const index = String(Math.max(0, Math.round(Number(body.sceneIndex) || 0)));
  if (body.locked) config.locks[index] = true;
  else delete config.locks[index];
  motionLib.writeMotion(config);
  return motionState();
}

async function regenerateSceneAction(body = {}) {
  const status = requireFreshStoryboard();
  const props = readJson(PROPS_FILE, null);
  const scenes = Array.isArray(props?.scenes) ? props.scenes : [];
  if (!scenes.length) throw new Error("还没有分镜，先运行一次生成流程");
  const index = Math.min(scenes.length - 1, Math.max(0, Math.round(Number(body.sceneIndex) || 0)));
  const config = motionLib.readMotion();
  if (config.locks?.[String(index)]) throw new Error("本幕已锁定，先解锁再重排");
  if (!config.source) config.source = { scriptHash: status.currentHash, sceneIds: status.sceneIds, at: Date.now() };
  const recipeAt = (at) => (at >= 0 && at < scenes.length ? motionLib.resolveMotionForScene(config, at) : null);
  const result = await motionLib.generateSceneMotion({
    scene: sceneDigest(scenes)[index],
    sceneIndex: index,
    total: scenes.length,
    theme: config.auto?.theme || "",
    current: recipeAt(index),
    prev: recipeAt(index - 1),
    next: recipeAt(index + 1),
    hint: String(body.prompt || "").slice(0, 200),
    count: 2,
  });
  if (!result.ok) throw new Error(result.reason || "单幕重排失败");

  const fresh = new Set(result.recipes.map((recipe) => recipe.id));
  const used = new Set(Object.values(config.assignments).filter(Boolean));
  for (const id of Object.keys(config.recipes)) {
    if (!fresh.has(id) && !used.has(id)) delete config.recipes[id];
  }
  for (const recipe of result.recipes) config.recipes[recipe.id] = recipe;
  motionLib.writeMotion(config);
  return {
    ...motionState(),
    recipes: result.recipes,
    sceneIndex: index,
    fallback: Boolean(result.fallback),
    model: result.model || null,
    reason: result.reason || null,
  };
}

function runStill(frame, outFile, propsFile) {
  return new Promise((resolve, reject) => {
    const args = [
      "still",
      "src/index.ts",
      "OralVideo",
      outFile,
      `--frame=${frame}`,
      `--props=${propsFile}`,
    ];
    const child = spawn(REMOTION_BIN, args, {
      cwd: REMOTION_DIR,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("预览渲染超时"));
    }, 180000);
    child.stderr?.on("data", (chunk) => {
      err += String(chunk);
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outFile)) resolve(outFile);
      else reject(new Error(err.trim().split("\n").slice(-3).join(" ") || `still 退出码 ${code}`));
    });
  });
}

async function renderMotionPreviews(sceneIndex) {
  const props = readJson(PROPS_FILE, null);
  if (!props || !Array.isArray(props.scenes) || !props.scenes.length) {
    throw new Error("还没有分镜，先运行一次生成流程");
  }
  const config = motionLib.readMotion();
  const index = Math.min(props.scenes.length - 1, Math.max(0, Math.round(Number(sceneIndex) || 0)));
  const merged = {
    ...props,
    scenes: props.scenes.map((scene, i) => ({
      ...scene,
      motion: motionLib.resolveMotionForScene(config, i),
    })),
  };
  const tmpProps = path.join(PIPELINE_ROOT, "output", ".motion-preview-props.json");
  fs.writeFileSync(tmpProps, JSON.stringify(merged), "utf8");

  let start = 0;
  for (let i = 0; i < index; i += 1) start += Number(props.scenes[i].durationInFrames) || 0;
  const duration = Math.max(1, Number(props.scenes[index].durationInFrames) || 1);
  const frames = [0.16, 0.5, 0.84].map((p) => start + Math.round(duration * p));

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const stamp = Date.now().toString(36);
  const urls = [];
  for (let i = 0; i < frames.length; i += 1) {
    const name = `motion-${index}-${i}-${stamp}.png`;
    await runStill(frames[i], path.join(PREVIEW_DIR, name), tmpProps);
    urls.push(`/api/motion/preview/${name}`);
  }
  try {
    const files = fs
      .readdirSync(PREVIEW_DIR)
      .filter((name) => name.endsWith(".png"))
      .map((name) => ({ name, mtime: fs.statSync(path.join(PREVIEW_DIR, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of files.slice(18)) fs.rmSync(path.join(PREVIEW_DIR, item.name), { force: true });
  } catch {}
  return { urls, sceneIndex: index, frames };
}

const STYLE_IDS = new Set(["amber", "tech", "paper", "mono"]);
const MOTION_IDS = new Set(["light", "standard", "strong"]);
const PROVIDER_IDS = new Set(["kaggle", "cosyvoice", "voicestudio", "local3", "indextts", "edge"]);

const STAGE_DEFS = {
  storyboard: { id: 1, name: "生成分镜" },
  voice: { id: 2, name: "合成配音" },
  digitalHuman: { id: 3, name: "生成数字人" },
  timeline: { id: 4, name: "时间轴与字幕" },
  render: { id: 5, name: "渲染画面" },
  compose: { id: 6, name: "合成成片" },
};

function buildStages(digitalHuman = false) {
  const weights = digitalHuman
    ? { storyboard: 5, voice: 35, digitalHuman: 20, timeline: 5, render: 27, compose: 8 }
    : { storyboard: 5, voice: 45, timeline: 5, render: 35, compose: 10 };
  return Object.entries(weights).map(([key, weight]) => ({ ...STAGE_DEFS[key], weight }));
}

const ANSI = /\x1b\[[0-9;]*m/g;
const clients = new Set();
let activeJob = null;
let currentJob = null;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function ttsBase() {
  return readJson(TTS_CONFIG, {});
}

function ttsMerged() {
  return mergeTtsConfig(ttsBase(), readPrivate());
}

function syncRunArtifact(job, name) {
  const src = path.join(job.dir, name);
  if (!fileOk(src, 2)) return false;
  const dst = name === "props.json" ? PROPS_FILE : name === "slides.json" ? SLIDES_FILE : path.join(PIPELINE_ROOT, "output", name);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  } catch {
    return false;
  }
}

function syncRunToGlobal(job, names = ["slides.json", "props.json"]) {
  let synced = false;
  for (const name of names) synced = syncRunArtifact(job, name) || synced;
  return synced;
}

function hydrateGlobalFromLatestRun() {
  let best = null;
  try {
    for (const id of fs.readdirSync(RUNS_DIR)) {
      const file = path.join(RUNS_DIR, id, "props.json");
      if (!fileOk(file, 2)) continue;
      const mtime = fs.statSync(file).mtimeMs;
      if (!best || mtime > best.mtime) best = { dir: path.join(RUNS_DIR, id), mtime };
    }
  } catch {
    return false;
  }
  if (!best) return false;
  let current = 0;
  try {
    current = fs.statSync(PROPS_FILE).mtimeMs;
  } catch {}
  if (best.mtime <= current) return false;
  return syncRunToGlobal({ dir: best.dir }, ["props.json", "slides.json"]);
}

function defaultScript() {
  return [
    "今天用一组真实数据，复盘终端运维自动化到底能省下多少成本。",
    "一家600台电脑的办公网络，IT团队平均每天要处理300次重复请求。",
    "其中软件安装和补丁更新，占掉了60%以上的日常工作量。",
    "引入统一部署和自动化之后，全网软件分发成功率从82%升到99.5%。",
    "补丁和版本更新导致的蓝屏故障率，下降了70%。",
    "按工时折算，团队每周节省40个小时，相当于多出半个人力。",
    "自动化的核心不是裁人，而是把工程师从重复劳动里解放出来，去做更有价值的架构优化。",
    "这组数据说明，终端运维自动化的投入，通常能在半年内回本。",
  ].join("\n");
}

function loadScript() {
  try {
    return fs.readFileSync(SCRIPT_FILE, "utf8").trimEnd();
  } catch {
    return defaultScript();
  }
}

function loadSeries() {
  const saved = readJson(SERIES_FILE, {});
  return {
    title: String(saved.title || "").slice(0, 40),
    tagline: String(saved.tagline || "").slice(0, 80),
  };
}

function saveSeries(title, tagline) {
  const value = {
    title: String(title || "").trim().slice(0, 40),
    tagline: String(tagline || "").trim().slice(0, 80),
  };
  writeJson(SERIES_FILE, value);
  return value;
}

const normalizeScriptText = (text) => String(text || "").replace(/^\uFEFF/, "").replace(/\s+/g, "");

function currentScriptHash() {
  return crypto.createHash("sha1").update(normalizeScriptText(loadScript())).digest("hex").slice(0, 16);
}

function storyboardStatus() {
  const props = readJson(PROPS_FILE, null);
  const scenes = Array.isArray(props?.scenes) ? props.scenes : [];
  const scriptText = normalizeScriptText(loadScript());
  const hash = currentScriptHash();
  if (!scenes.length) {
    return {
      stale: true,
      empty: true,
      reason: "no-storyboard",
      currentHash: hash,
      propsHash: null,
      sceneIds: [],
      sceneIdsChanged: false,
      planStale: false,
      materialsStale: false,
      propsMaterialsHash: null,
      materialsHash: materialsHash(),
    };
  }
  const metaHash = String(props?.meta?.scriptHash || "");
  const propsMaterialsHash = String(props?.meta?.materialsHash || "");
  const materialsNow = materialsHash();
  const hasMaterialState = Boolean(materialsNow || propsMaterialsHash);
  const materialsStale = hasMaterialState && propsMaterialsHash !== materialsNow;
  const sceneIds = scenes.map((scene) => String(scene.id || ""));
  let stale = false;
  if (metaHash) {
    stale = metaHash !== hash;
  } else {
    const corpus = normalizeScriptText(
      scenes
        .map((scene) =>
          [scene.title, scene.barTitle, scene.speech, ...(scene.lines || []), ...(scene.bullets || [])].join(""),
        )
        .join(""),
    );
    const len = scriptText.length;
    const windows = [0.08, 0.5, 0.9]
      .map((ratio) => {
        const start = Math.max(0, Math.floor(len * ratio) - 10);
        return scriptText.slice(start, start + 20);
      })
      .filter((sample) => sample.length >= 8);
    const hits = windows.filter((sample) => corpus.includes(sample)).length;
    stale = windows.length ? hits < 2 : true;
  }
  if (materialsStale) stale = true;
  const config = motionLib.readMotion();
  const source = config.source || null;
  const sceneIdsChanged = Boolean(source?.sceneIds?.length) && source.sceneIds.join("|") !== sceneIds.join("|");
  const hasAssignments = Object.keys(config.assignments || {}).length > 0;
  const planStale = source
    ? Boolean(sceneIdsChanged || (metaHash ? source.scriptHash !== metaHash : stale))
    : Boolean(metaHash && hasAssignments);
  return {
    stale,
    empty: false,
    reason: materialsStale && metaHash === hash ? "materials-changed" : stale ? "script-changed" : "ok",
    currentHash: hash,
    propsHash: metaHash || null,
    sceneIds,
    sceneIdsChanged,
    planStale,
    materialsStale,
    propsMaterialsHash: propsMaterialsHash || null,
    materialsHash: materialsNow,
  };
}

function requireFreshStoryboard({ allowPlanStale = false } = {}) {
  const status = storyboardStatus();
  if (status.stale) {
    throw new Error(status.empty ? "还没有分镜，先运行一次生成流程" : "文案已更新，请先重新生成分镜");
  }
  if (status.planStale && !allowPlanStale) {
    throw new Error("分镜已更新，请先重新自动编排");
  }
  return status;
}

let storyboardPrep = null;

function prepState() {
  if (!storyboardPrep) {
    const status = storyboardStatus();
    return {
      state: "idle",
      stage: "",
      startedAt: null,
      finishedAt: null,
      error: "",
      motionError: "",
      logs: [],
      pending: false,
      storyboard: status,
    };
  }
  return {
    ...storyboardPrep,
    logs: storyboardPrep.logs.slice(-80),
    storyboard: storyboardStatus(),
  };
}

function setPrep(patch) {
  if (!storyboardPrep) return;
  Object.assign(storyboardPrep, patch);
  broadcast("prep", prepState());
}

function addPrepLog(line) {
  if (!storyboardPrep) return;
  const clean = String(line || "").trim();
  if (!clean) return;
  storyboardPrep.logs.push({ t: Date.now(), line: clean });
  if (storyboardPrep.logs.length > 400) storyboardPrep.logs.splice(0, storyboardPrep.logs.length - 400);
  broadcast("prep", prepState());
}

function runPrepCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: PIPELINE_ROOT,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    let errorTail = "";
    const pipe = (stream, isError = false) => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          addPrepLog(line);
          if (isError && line.trim()) errorTail = line.trim();
        }
      });
      stream.on("end", () => {
        if (buffer) {
          addPrepLog(buffer);
          if (isError && buffer.trim()) errorTail = buffer.trim();
        }
      });
    };
    pipe(child.stdout);
    pipe(child.stderr, true);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorTail || `子进程退出码 ${code}`));
    });
  });
}

async function runStoryboardPrep({ force = false, autoMotion = true, reason = "" } = {}) {
  if (activeJob?.running) throw new Error("视频正在生成，暂时不能更新分镜");
  if (storyboardPrep?.state === "running") {
    storyboardPrep.pending = true;
    setPrep({ pending: true });
    return { ...prepState(), started: false, pending: true };
  }
  const status = storyboardStatus();
  if (!force && !status.stale) {
    return { ...prepState(), skipped: true, started: false };
  }
  storyboardPrep = {
    state: "running",
    stage: "生成分镜",
    startedAt: Date.now(),
    finishedAt: null,
    error: "",
    motionError: "",
    autoMotion: Boolean(autoMotion),
    reason: String(reason || ""),
    scriptHash: currentScriptHash(),
    logs: [],
    pending: false,
  };
  broadcast("prep", prepState());
  runStoryboardPrepWork(autoMotion).catch((err) => {
    setPrep({
      state: "error",
      stage: "失败",
      finishedAt: Date.now(),
      error: err?.message || String(err),
    });
  });
  return { ...prepState(), started: true };
}

async function runStoryboardPrepWork(autoMotion) {
  try {
    addPrepLog("开始读取文案并生成分镜…");
    const series = loadSeries();
    const prepArgs = ["pipeline/01_storyboard.mjs", "--script", SCRIPT_FILE];
    if (series.title) prepArgs.push("--series-title", series.title);
    if (series.tagline) prepArgs.push("--series-tagline", series.tagline);
    await runPrepCommand(prepArgs);
    setPrep({ stage: "预生成画面" });
    addPrepLog("分镜已生成，正在准备画面与素材映射…");
    await runPrepCommand(["pipeline/01b_preview_props.mjs"]);
    const status = storyboardStatus();
    if (status.stale) throw new Error("分镜生成后文案仍不一致，请重试");
    if (autoMotion) {
      setPrep({ stage: "编排动效" });
      addPrepLog("分镜已就绪，开始自动编排动效…");
      try {
        const motion = await autoMotionAction({ prompt: "" });
        addPrepLog(`动效编排完成：${motion.theme || "已分配"}${motion.fallback ? "（本地兜底）" : ""}`);
      } catch (err) {
        const message = err?.message || "自动编排失败";
        addPrepLog(`动效编排失败：${message}；分镜仍可使用，可手动重排。`);
        setPrep({ motionError: message });
      }
    }
    setPrep({ state: "done", stage: "完成", finishedAt: Date.now(), error: "" });
  } finally {
    const pending = Boolean(storyboardPrep?.pending);
    if (pending) {
      storyboardPrep.pending = false;
      setTimeout(() => {
        runStoryboardPrep({ force: false, autoMotion }).catch((err) => {
          setPrep({ state: "error", stage: "失败", error: err?.message || String(err) });
        });
      }, 400);
    }
  }
}

function listVoices() {
  try {
    return fs.readdirSync(VOICE_DIR)
      .filter((name) => /\.(wav|mp3|m4a|flac)$/i.test(name) && !name.startsWith("_upload-"))
      .map((name) => {
        const stat = fs.statSync(path.join(VOICE_DIR, name));
        return { name, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function probeDuration(file) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf8", timeout: 15000, windowsHide: true },
  );
  const duration = Number.parseFloat(out.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取音频时长，请换一个文件");
  return duration;
}

function pruneUploads() {
  try {
    for (const name of fs.readdirSync(VOICE_DIR)) {
      if (!name.startsWith("_upload-")) continue;
      const file = path.join(VOICE_DIR, name);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > 24 * 60 * 60 * 1000) fs.rmSync(file, { force: true });
      } catch {}
    }
  } catch {}
}

function fileOk(file, min = 1) {
  try {
    return fs.statSync(file).size >= min;
  } catch {
    return false;
  }
}

function kaggleToken() {
  const priv = readPrivate();
  const kaggle = priv.kaggle || {};
  if (String(kaggle.username || "").trim() && String(kaggle.key || kaggle.token || "").trim()) return true;
  const local = privatePaths(priv);
  const dirs = [
    local.kaggleConfigDir,
    process.env.KAGGLE_CONFIG_DIR || "",
    path.join(os.homedir(), ".kaggle"),
  ].filter(Boolean);
  return dirs.some((dir) => ["access_token", "kaggle.json"].some((name) => fileOk(path.join(dir, name), 20)));
}

let gpuCache;
function gpuName() {
  if (gpuCache !== undefined) return gpuCache;
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    }).trim().split(/\r?\n/)[0];
    gpuCache = out || "未知";
    return gpuCache;
  } catch {
    try {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
      );
      const names = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const pick = names.find((name) => /NVIDIA/i.test(name)) || names.find((name) => /AMD|Radeon|Intel/i.test(name)) || names[0];
      gpuCache = pick || "未检测";
      return gpuCache;
    } catch {
      gpuCache = "未检测";
      return gpuCache;
    }
  }
}

let vsStatus = { ok: false, text: "未启动", checkedAt: 0 };

function voicestudioBase() {
  const tts = ttsMerged();
  return String(tts.voicestudio?.apiBase || "http://127.0.0.1:3900").replace(/\/+$/, "");
}

async function probeVoiceStudio() {
  const base = voicestudioBase();
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2500) });
    const data = res.ok ? await res.json().catch(() => ({})) : null;
    vsStatus = res.ok
      ? { ok: true, text: data?.engine ? `已连接 · ${data.engine}` : "已连接", checkedAt: Date.now() }
      : { ok: false, text: "未启动", checkedAt: Date.now() };
  } catch {
    vsStatus = { ok: false, text: "未启动", checkedAt: Date.now() };
  }
  return { ...vsStatus, base };
}

function voicestudioPort() {
  try {
    const url = new URL(voicestudioBase());
    return Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  } catch {
    return 3900;
  }
}

function stopVoiceStudio() {
  const port = voicestudioPort();
  try {
    const out = execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { taskkill /PID $($c.OwningProcess) /T /F | Out-Null; 'killed' } else { 'none' }`,
    ], { encoding: "utf8", timeout: 20000, windowsHide: true });
    return /killed/.test(out);
  } catch {
    return false;
  }
}

function launchVoiceStudio() {
  const root = privatePaths().voiceStudioRoot;
  const spec = readJson(path.join(root, "server.env.json"), null);
  if (!spec?.python || !fileOk(spec.python, 1024)) {
    return { ok: false, error: "缺少 VoiceStudio 启动配置或 Python 环境" };
  }
  const port = Number(spec.port) || 3900;
  const logDir = path.join(root, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const outFd = fs.openSync(path.join(logDir, "server.out.log"), "a");
  const errFd = fs.openSync(path.join(logDir, "server.err.log"), "a");
  try {
    const child = spawn(
      spec.python,
      ["-m", "uvicorn", "main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: root,
        env: { ...process.env, ...(spec.env || {}) },
        detached: true,
        stdio: ["ignore", outFd, errFd],
        windowsHide: true,
      },
    );
    child.unref();
  } catch (err) {
    return { ok: false, error: err?.message || "启动失败" };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  return { ok: true };
}

async function ensureVoiceStudio() {
  const current = await probeVoiceStudio();
  if (current.ok) return { ok: true, started: false };
  const launch = launchVoiceStudio();
  if (!launch.ok) return { ok: false, started: false, error: launch.error };
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const status = await probeVoiceStudio();
    if (status.ok) return { ok: true, started: true };
  }
  return { ok: false, started: true, error: "VoiceStudio 启动超时" };
}

function envStatus(tts) {
  const local = privatePaths();
  const cosy = tts.cosyvoice || {};
  const modelDir = path.resolve(cosy.modelPath || local.cosyvoiceModel);
  const cosyReady = ["llm.pt", "flow.pt", "hift.pt", "speech_tokenizer_v2.onnx"]
    .every((name) => fileOk(path.join(modelDir, name), 1024));
  const inde = tts.indextts || {};
  const indeRepo = path.resolve(inde.repoPath || local.indexttsRepo);
  const indeReady = fileOk(path.join(inde.modelDir || local.indexttsModel || path.join(indeRepo, "checkpoints"), "config.yaml"));
  const kaggleBin = path.resolve(local.kaggleBin || inde.kaggleBin || "kaggle");
  const hasToken = kaggleToken();
  return [
    { key: "node", label: "Node", ok: true, text: process.version },
    { key: "python", label: "Python", ok: fileOk(PYTHON, 1024), text: fileOk(PYTHON, 1024) ? "已就绪" : "未找到" },
    { key: "gpu", label: "GPU", ok: gpuName() !== "未检测", text: gpuName() },
    { key: "kaggle", label: "Kaggle", ok: hasToken && fileOk(kaggleBin, 1024), text: hasToken ? (fileOk(kaggleBin, 1024) ? "已连接" : "缺少 CLI") : "缺少凭据" },
    { key: "cosyvoice", label: "CosyVoice", ok: cosyReady, text: cosyReady ? "模型完整" : "模型不完整" },
    { key: "voicestudio", label: "VoiceStudio", ok: vsStatus.ok, text: vsStatus.text },
    { key: "indextts", label: "IndexTTS", ok: indeReady, text: indeReady ? "本机可用" : "未安装" },
  ];
}

function sanitizeAi(raw = {}) {
  const base = String(raw.baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const envName = /^[A-Z][A-Z0-9_]{2,}$/;
  let keyEnv = String(raw.keyEnv || "OPENAI_API_KEY").trim() || "OPENAI_API_KEY";
  let apiKey = String(raw.apiKey || "").trim();
  if (!apiKey && keyEnv && !envName.test(keyEnv)) {
    apiKey = keyEnv;
    keyEnv = "OPENAI_API_KEY";
  }
  return {
    enabled: raw.enabled === true,
    baseUrl: /^https?:\/\//i.test(base) ? base : "https://api.openai.com/v1",
    model: String(raw.model || "gpt-4o-mini").trim() || "gpt-4o-mini",
    keyEnv,
    apiKey,
    temperature: Math.min(2, Math.max(0, Number(raw.temperature ?? 0.4) || 0)),
    maxTokens: Math.min(8000, Math.max(400, Number(raw.maxTokens) || 2400)),
    extraPrompt: String(raw.extraPrompt || "").slice(0, 800),
  };
}

function maskAi(raw = {}) {
  const ai = sanitizeAi(raw);
  const hasApiKey = Boolean(String(ai.apiKey || process.env[ai.keyEnv || ""] || "").trim());
  return { ...ai, apiKey: "", hasApiKey };
}

const PRIVATE_TTS_FIELDS = new Set([
  "repoPath",
  "python",
  "modelDir",
  "vendorPath",
  "modelPath",
  "enginePython",
  "dspBackendDir",
  "kaggleBin",
  "refWav",
  "promptWav",
  "refText",
  "profileId",
]);

function stripPrivateTts(tts = {}) {
  const out = JSON.parse(JSON.stringify(tts));
  for (const value of Object.values(out)) {
    if (!value || typeof value !== "object") continue;
    for (const key of PRIVATE_TTS_FIELDS) delete value[key];
  }
  return out;
}

function publicVoicePath(file) {
  const text = String(file || "").trim();
  if (!text) return "";
  if (!path.isAbsolute(text)) return text.replaceAll("\\", "/");
  const rel = path.relative(PIPELINE_ROOT, text);
  return rel.startsWith("..") ? text : rel.replaceAll("\\", "/");
}

function currentConfigs() {
  const tts = ttsMerged();
  const ui = readJson(UI_CONFIG, {});
  const layout = normalizeLayoutConfig(
    ui.layout && typeof ui.layout === "object"
      ? ui.layout
      : { layout: ui.layout, avatarVideo: ui.avatarVideo, avatarHeight: ui.avatarHeight },
  );
  return {
    tts,
    ai: maskAi(privateAi() || readJson(AI_CONFIG, {})),
    ui: {
      styleId: STYLE_IDS.has(ui.styleId) ? ui.styleId : "amber",
      motion: MOTION_IDS.has(ui.motion) ? ui.motion : "standard",
      layout,
      digitalHuman: normalizeDigitalHuman(ui.digitalHuman, layout),
      presetId: ui.presetId || "",
      gap: Number.isFinite(Number(ui.gap)) ? Number(ui.gap) : 0.26,
      leadIn: Number.isFinite(Number(ui.leadIn)) ? Number(ui.leadIn) : 0.25,
      tighten: ui.tighten !== false,
    },
  };
}

function saveConfig(payload) {
  const before = ttsBase();
  const tts = { ...before };
  const provider = PROVIDER_IDS.has(payload.provider) ? payload.provider : tts.provider || "kaggle";
  tts.provider = provider;
  tts.speakRate = 1;
  const uiIn = payload.ui || {};
  const gap = Number(payload.gapSeconds);
  tts.gapSeconds = Number.isFinite(gap) ? gap : (Number(uiIn.gap) || 0.26);

  const voice = payload.voice || "";
  if (payload.kaggle) tts.kaggle = { ...(tts.kaggle || {}), ...payload.kaggle };
  if (payload.cosyvoice) tts.cosyvoice = { ...(tts.cosyvoice || {}), ...payload.cosyvoice };
  if (payload.voicestudio) tts.voicestudio = { ...(tts.voicestudio || {}), ...payload.voicestudio };
  if (payload.local3) tts.local3 = { ...(tts.local3 || {}), ...payload.local3 };
  if (payload.indextts) tts.indextts = { ...(tts.indextts || {}), ...payload.indextts };
  if (payload.edge) tts.edge = { ...(tts.edge || {}), ...payload.edge };
  if (voice && provider !== "edge") {
    const absVoice = path.isAbsolute(voice) ? voice : path.join(VOICE_DIR, voice);
    const voicePath = publicVoicePath(absVoice);
    const prev = ttsMerged();
    const prevCfg = prev[provider] || {};
    const prevVoice = prevCfg.refWav || prevCfg.promptWav || "";
    const prevAbs = prevVoice
      ? (path.isAbsolute(prevVoice) ? prevVoice : path.join(PIPELINE_ROOT, prevVoice))
      : "";
    const sameVoice = Boolean(prevAbs && path.resolve(prevAbs) === path.resolve(absVoice));
    let refText = "";
    try {
      refText = fs.readFileSync(absVoice.replace(/\.[^.]+$/, ".txt"), "utf8").trim();
    } catch {}
    if (!refText && sameVoice) refText = String(prevCfg.refText || "").trim();
    writePrivate({
      tts: {
        kaggle: { promptWav: voicePath },
        cosyvoice: { refWav: voicePath, refText },
        voicestudio: { refWav: voicePath, refText },
        local3: { refWav: voicePath, refText },
        indextts: { promptWav: voicePath },
      },
    });
  }
  const publicTts = stripPrivateTts(tts);
  writeJson(TTS_CONFIG, publicTts);

  const layout = normalizeLayoutConfig(
    uiIn.layout && typeof uiIn.layout === "object"
      ? uiIn.layout
      : { layout: uiIn.layout, avatarVideo: uiIn.avatarVideo, avatarHeight: uiIn.avatarHeight },
  );
  const digitalHuman = normalizeDigitalHuman(uiIn.digitalHuman, layout);
  if (digitalHuman.enabled) {
    layout.mode = "video";
    if (!digitalHuman.reference && layout.avatar.src) digitalHuman.reference = layout.avatar.src;
  }
  const ui = {
    styleId: STYLE_IDS.has(uiIn.styleId) ? uiIn.styleId : "amber",
    motion: MOTION_IDS.has(uiIn.motion) ? uiIn.motion : "standard",
    layout,
    digitalHuman,
    presetId: typeof uiIn.presetId === "string" ? uiIn.presetId : "",
    gap: Number.isFinite(Number(uiIn.gap)) ? Number(uiIn.gap) : 0.26,
    leadIn: Number.isFinite(Number(uiIn.leadIn)) ? Number(uiIn.leadIn) : 0.25,
    tighten: uiIn.tighten !== false,
  };
  writeJson(UI_CONFIG, ui);
  writeJson(LAYOUT_CONFIG, { version: 2, ...ui.layout });

  const prevAi = privateAi() || readJson(AI_CONFIG, {});
  const aiIn = payload.ai || {};
  const aiKey = String(aiIn.apiKey || "").trim();
  const ai = sanitizeAi({
    ...prevAi,
    ...aiIn,
    apiKey: aiKey || prevAi.apiKey || "",
  });
  writePrivate({ ai, source: readPrivate().source || "manual" });
  writeJson(AI_CONFIG, { ...ai, apiKey: "" });
  return { tts: ttsMerged(), ui, ai: maskAi(ai) };
}

function publicJob(job) {
  if (!job) return null;
  const { logs, ...rest } = job;
  return rest;
}

function overall(job) {
  let score = 0;
  for (const stage of job.stages) {
    if (stage.status === "done") score += stage.weight;
    else if (stage.status === "running") score += stage.weight * (stage.progress || 0);
  }
  return Math.min(1, score / 100);
}

function persist(job) {
  try {
    const file = path.join(job.dir, "job.json");
    const payload = { ...job, logs: job.logs.slice(-200) };
    writeJson(file, payload);
  } catch {}
}

function broadcast(event, data) {
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(text);
    } catch {
      clients.delete(res);
    }
  }
}

function broadcastState() {
  if (currentJob) broadcast("state", publicJob(currentJob));
}

function addLog(job, stage, line, level = "info") {
  const entry = { t: Date.now(), stage, level, line };
  job.logs.push(entry);
  if (job.logs.length > 3000) job.logs.splice(0, job.logs.length - 3000);
  try {
    fs.appendFileSync(path.join(job.dir, "run.log"), `${line}\n`, "utf8");
  } catch {}
  broadcast("log", entry);
}

function stageById(job, id) {
  return job.stages.find((stage) => stage.id === id);
}

function setProgress(job, stageId, progress, note) {
  const stage = stageById(job, stageId);
  if (!stage) return;
  stage.progress = Math.max(stage.progress || 0, Math.min(1, progress));
  if (note) job.note = note;
  job.progress = overall(job);
  broadcastState();
}

function parseLine(job, stageId, raw) {
  const line = raw.replace(ANSI, "").replace(/\r$/, "").trimEnd();
  if (!line.trim()) return;
  let level = "info";
  if (/(error|错误|失败|traceback|exception|cannot|not found)/i.test(line)) level = "error";
  else if (/(warn|警告|deprecated|clipping)/i.test(line)) level = "warn";

  if (stageId === 1) {
    if (/正在请求模型/.test(line)) setProgress(job, 1, 0.35, "请求 AI 分镜…");
    if (/AI 返回正常/.test(line)) setProgress(job, 1, 0.7, "AI 分镜已生成");
    const done = line.match(/分镜完成：(\d+) 句 \/ (\d+) 幕/);
    if (done) {
      job.segmentTotal = Number(done[1]) || job.segmentTotal;
      setProgress(job, 1, 1, `${done[1]} 句 / ${done[2]} 幕`);
    }
  }

  if (stageId === 3) {
    if (/Kaggle 账号|参考视频/.test(line)) setProgress(job, 3, 0.08, "准备数字人素材…");
    if (/创建|更新.*数据集/.test(line)) setProgress(job, 3, 0.18, "上传数字人素材…");
    if (/推送 Notebook/.test(line)) setProgress(job, 3, 0.28, "提交 Kaggle 任务…");
    if (/等待运行/.test(line)) setProgress(job, 3, 0.35, "Kaggle GPU 生成中…");
    const poll = line.match(/\[(\d{2}):(\d{2}):(\d{2})\]\s+(\S+)/);
    if (poll) {
      job.dhPolls = (job.dhPolls || 0) + 1;
      setProgress(job, 3, Math.min(0.8, 0.35 + job.dhPolls * 0.02), `Kaggle 状态 ${poll[4]}`);
    }
    if (/下载成片/.test(line)) setProgress(job, 3, 0.86, "下载数字人成片…");
    if (/数字人完成/.test(line)) setProgress(job, 3, 1, "数字人成片已就绪");
  }

  if (stageId === 4) {
    const fetchHit = line.match(/\[03\] 补图 (\S+)/);
    if (fetchHit && !/完成|失败/.test(line)) setProgress(job, 4, 0.2, `配图 ${fetchHit[1]}`);
    const total = line.match(/\[03\] 时间轴：\d+ 句 \/ (\d+) 幕/);
    if (total) job.sceneTotal = Number(total[1]) || job.sceneTotal;
    const scene = line.match(/\[03\] (sc\d+)/);
    if (scene && job.sceneTotal) {
      const n = Number(scene[1].slice(2)) || 0;
      setProgress(job, 4, Math.min(0.95, n / job.sceneTotal), `幕 ${n}/${job.sceneTotal}`);
    }
  }

  if (stageId === 5) {
    const rendered = line.match(/Rendered\s+(\d+)\/(\d+)/);
    if (rendered) {
      const done = Number(rendered[1]);
      const total = Number(rendered[2]) || 1;
      setProgress(job, 5, 0.85 * (done / total), `已渲染 ${done}/${total} 帧`);
      const mark = Math.floor((done / total) * 10);
      if (mark > (job.renderMark || 0) && mark < 10) {
        job.renderMark = mark;
        addLog(job, 5, `渲染进度 ${mark * 10}%（${done}/${total} 帧）`);
      }
      return;
    }
    const encoded = line.match(/Encoded\s+(\d+)\/(\d+)/);
    if (encoded) {
      const done = Number(encoded[1]);
      const total = Number(encoded[2]) || 1;
      setProgress(job, 5, 0.85 + 0.15 * (done / total), `编码 ${done}/${total}`);
      return;
    }
  }

  addLog(job, stageId, line, level);

  if (stageId === 2) {
    const match = line.match(/^\s+(s\d+)\s+([\d.]+)s/);
    if (match) {
      const done = Number(match[1].slice(1));
      const total = job.segmentTotal || 8;
      setProgress(job, 2, done / total, `第 ${done}/${total} 句`);
    }
  }

  if (stageId === 6 && /成片完成|合成完成/.test(line)) {
    setProgress(job, 6, 1, "合成完成");
  }
}

function runStage(job, stageId, args) {
  return new Promise((resolve, reject) => {
    const stage = stageById(job, stageId);
    stage.status = "running";
    stage.startedAt = Date.now();
    stage.progress = 0;
    job.stage = stageId;
    job.note = stage.name;
    job.progress = overall(job);
    addLog(job, stageId, `▶ 阶段开始：${stage.name}`);
    broadcastState();

    const env = {
      ...process.env,
      OD_OUTPUT_DIR: job.outputRel,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
    };
    const child = spawn(process.execPath, args, {
      cwd: PIPELINE_ROOT,
      env,
      windowsHide: true,
    });
    job.child = child;

    const pipe = (stream) => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() || "";
        for (const line of lines) parseLine(job, stageId, line);
      });
      stream.on("end", () => {
        if (buffer) parseLine(job, stageId, buffer);
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      job.child = null;
      const seconds = ((Date.now() - stage.startedAt) / 1000).toFixed(1);
      if (job.cancelRequested) {
        addLog(job, stageId, `■ 阶段已取消：${stage.name}（${seconds}s）`, "warn");
        resolve(code ?? 130);
        return;
      }
      if (code === 0) {
        addLog(job, stageId, `✔ 阶段完成：${stage.name}（${seconds}s）`);
        resolve(0);
      } else {
        addLog(job, stageId, `✖ 阶段失败：${stage.name}（退出码 ${code}，${seconds}s）`, "error");
        reject(new Error(`${stage.name}失败，退出码 ${code}`));
      }
    });
  });
}

function slidesSignature(file) {
  const payload = readJson(file, null);
  const slides = Array.isArray(payload?.slides) ? payload.slides : [];
  if (!slides.length) return "";
  return slides
    .map((slide) => `${slide.id}:${crypto.createHash("sha1").update(String(slide.speech || "")).digest("hex").slice(0, 8)}`)
    .join("|");
}

function findReusableVoice(scriptHash, tts, ui, slidesFile) {
  const signature = slidesSignature(slidesFile);
  if (!signature) return null;
  let candidates = [];
  try {
    candidates = fs
      .readdirSync(RUNS_DIR)
      .map((id) => {
        const dir = path.join(RUNS_DIR, id);
        const job = readJson(path.join(dir, "job.json"), null);
        if (!job || !fileOk(path.join(dir, "voice.wav"), 1024) || !fileOk(path.join(dir, "timeline.json"), 2)) return null;
        return { id, dir, job };
      })
      .filter(Boolean)
      .sort((a, b) => (b.job.startedAt || 0) - (a.job.startedAt || 0));
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    try {
      const runScript = fs.readFileSync(path.join(candidate.dir, "script.txt"), "utf8");
      const runHash = crypto
        .createHash("sha1")
        .update(normalizeScriptText(runScript))
        .digest("hex")
        .slice(0, 16);
      if (runHash !== scriptHash) continue;
      if (JSON.stringify(candidate.job.config || {}) !== JSON.stringify(tts || {})) continue;
      const prevUi = candidate.job.ui || {};
      if (Number(prevUi.gap ?? 0.26) !== Number(ui.gap ?? 0.26)) continue;
      if (Number(prevUi.leadIn ?? 0.25) !== Number(ui.leadIn ?? 0.25)) continue;
      if (Boolean(prevUi.tighten ?? true) !== Boolean(ui.tighten ?? true)) continue;
      if (slidesSignature(path.join(candidate.dir, "slides.json")) !== signature) continue;
      return candidate;
    } catch {}
  }
  return null;
}

function computeRunPlan(tts, ui) {
  const status = storyboardStatus();
  const voice = status.stale ? null : findReusableVoice(status.currentHash, tts, ui, SLIDES_FILE);
  return {
    storyboard: !status.stale,
    voice: Boolean(voice),
    voiceFrom: voice?.id || null,
    skipStage1: !status.stale,
    skipStage2: Boolean(voice),
    fromStage: !status.stale ? (voice ? 3 : 2) : 1,
  };
}

function copyArtifact(from, to) {
  try {
    if (!fileOk(from, 2)) return false;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return true;
  } catch {
    return false;
  }
}

function markStageReused(job, stageId, note) {
  const stage = stageById(job, stageId);
  if (!stage) return;
  stage.status = "done";
  stage.reused = true;
  stage.progress = 1;
  stage.startedAt = Date.now();
  stage.finishedAt = Date.now();
  stage.note = note;
  if (!job.reusedStages.includes(stageId)) job.reusedStages.push(stageId);
}

function prepareJobReuse(job, { resume = true, forceStoryboard = false, forceAll = false } = {}) {
  if (!resume || forceAll) return;
  const status = storyboardStatus();
  if (!forceStoryboard && !status.stale && fileOk(SLIDES_FILE, 2)) {
    const copiedSlides = copyArtifact(SLIDES_FILE, path.join(job.dir, "slides.json"));
    if (copiedSlides) {
      copyArtifact(PROPS_FILE, path.join(job.dir, "props.json"));
      markStageReused(job, 1, "复用上次分镜");
    }
  }
  if (!forceStoryboard && fileOk(path.join(job.dir, "slides.json"), 2)) {
    const voice = findReusableVoice(status.currentHash, job.config, job.ui, path.join(job.dir, "slides.json"));
    if (voice) {
      const copiedVoice = copyArtifact(path.join(voice.dir, "voice.wav"), path.join(job.dir, "voice.wav"));
      const copiedTimeline = copyArtifact(path.join(voice.dir, "timeline.json"), path.join(job.dir, "timeline.json"));
      if (copiedVoice && copiedTimeline) {
        markStageReused(job, 2, "复用上次配音");
        job.reuseVoiceFrom = voice.id;
      }
    }
  }
}

function runAux(job, args, label) {
  return new Promise((resolve, reject) => {
    addLog(job, 1, `… ${label}`);
    const child = spawn(process.execPath, args, {
      cwd: PIPELINE_ROOT,
      env: { ...process.env, OD_OUTPUT_DIR: job.outputRel, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    let tail = "";
    const pipe = (stream) => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          parseLine(job, 1, line);
          tail = line.trim() || tail;
        }
      });
      stream.on("end", () => {
        if (buffer) {
          parseLine(job, 1, buffer);
          tail = buffer.trim() || tail;
        }
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(tail || `${label}失败，退出码 ${code}`));
    });
  });
}


function readSlidesCount(dir) {
  const slides = readJson(path.join(dir, "slides.json"), null);
  return Array.isArray(slides?.slides) ? slides.slides.length : 0;
}

function finishJob(job, status, error = "") {
  job.status = status;
  job.finishedAt = Date.now();
  job.running = false;
  for (const stage of job.stages) {
    if (stage.status === "running") stage.status = status === "canceled" ? "canceled" : (status === "error" ? "error" : "done");
    if (stage.status === "done") stage.progress = 1;
  }
  if (status === "done") {
    const timeline = readJson(path.join(job.dir, "timeline.json"), null);
    job.duration = Number(timeline?.total) || null;
    job.segmentTotal = readSlidesCount(job.dir) || job.segmentTotal;
    const final = path.join(job.dir, "final.mp4");
    if (fileOk(final, 1024)) {
      job.finalVideo = final;
      job.size = fs.statSync(final).size;
    }
    syncRunToGlobal(job, ["props.json", "slides.json"]);
    job.progress = 1;
  } else if (error) {
    job.error = error;
  }
  if (job.vsStarted) {
    const stopped = stopVoiceStudio();
    job.vsStarted = false;
    if (stopped) addLog(job, 6, "任务结束，已关闭后台 VoiceStudio 服务");
    else addLog(job, 6, "任务结束，VoiceStudio 服务已自行退出");
  }
  persist(job);
  broadcastState();
  activeJob = null;
}

function killTree(job) {
  if (!job?.child) return;
  try {
    spawn("taskkill", ["/pid", String(job.child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    try {
      job.child.kill();
    } catch {}
  }
}

function stageArgs(job, stageId) {
  const config = job.config;
  const ui = job.ui;
  if (stageId === 1) {
    const args = ["pipeline/01_storyboard.mjs", "--script", path.join(job.dir, "script.txt")];
    if (job.seriesTitle) args.push("--series-title", job.seriesTitle);
    if (job.seriesTagline) args.push("--series-tagline", job.seriesTagline);
    return args;
  }
  if (stageId === 2) {
    const args = [
      "pipeline/02_tts.mjs",
      "--provider", config.provider || "kaggle",
      "--gap", String(ui.gap),
      "--lead-in", String(ui.leadIn),
    ];
    if (!ui.tighten) args.push("--no-tighten");
    const vs = config.voicestudio || {};
    const pagePause = Number(vs.pagePauseSeconds);
    if (config.provider === "voicestudio" && vs.singlePass !== false && Number.isFinite(pagePause)) {
      args.push("--page-pause", String(pagePause));
    }
    return args;
  }
  if (stageId === 3) {
    const dh = ui.digitalHuman || {};
    const args = [
      "pipeline/digital_human.mjs",
      "--reference", String(dh.reference || ""),
      "--voice", path.join(job.dir, "voice.wav"),
      "--variant", DH_VARIANTS.has(dh.variant) ? dh.variant : "closeup",
      "--run-id", job.id,
      "--max-side", String(dh.maxSide || 1440),
      "--timeout", String(dh.timeoutMin || 120),
    ];
    if (dh.cropPct) args.push("--crop-pct", dh.cropPct);
    return args;
  }
  if (stageId === 4) return ["pipeline/03_timeline.mjs"];
  if (stageId === 5) return ["pipeline/04_render.mjs"];
  return ["pipeline/05_compose.mjs"];
}

async function executeJob(job) {
  try {
    for (let i = 0; i < job.stages.length; i += 1) {
      const stage = job.stages[i];
      if (job.cancelRequested) break;
      if (stage.reused) {
        addLog(job, stage.id, `↺ ${stage.note || "复用上次结果"}`);
        job.progress = overall(job);
        persist(job);
        broadcastState();
        continue;
      }
      if (stage.id === 2 && job.config.provider === "voicestudio" && !job.vsStarted) {
        addLog(job, 2, "检查 VoiceStudio 后台服务…");
        const vs = await ensureVoiceStudio();
        if (vs.started) job.vsStarted = true;
        if (vs.started) addLog(job, 2, "已在后台启动 VoiceStudio 服务（任务结束后自动关闭）");
        else if (vs.ok) addLog(job, 2, "复用已在运行的 VoiceStudio 服务");
        if (!vs.ok) throw new Error(vs.error || "VoiceStudio 服务不可用");
        if (job.cancelRequested) break;
      }
      await runStage(job, stage.id, stageArgs(job, stage.id));
      if (job.cancelRequested) {
        stage.status = "canceled";
        break;
      }
      stage.status = "done";
      stage.finishedAt = Date.now();
      stage.progress = 1;
      if (stage.id === 1) {
        try {
          await runAux(job, ["pipeline/01b_preview_props.mjs"], "准备分镜画面预览");
        } catch (err) {
          addLog(job, 1, `分镜画面预览失败：${err?.message || err}`, "warn");
        }
        syncRunToGlobal(job, ["props.json", "slides.json"]);
      }
      if (stage.id === 4) syncRunToGlobal(job, ["props.json", "slides.json"]);
      if (stage.id === 1 || stage.id === 2) job.segmentTotal = readSlidesCount(job.dir) || job.segmentTotal;
      job.progress = overall(job);
      persist(job);
      broadcastState();
    }
    if (job.cancelRequested) finishJob(job, "canceled");
    else finishJob(job, "done");
  } catch (err) {
    if (job.cancelRequested) finishJob(job, "canceled");
    else finishJob(job, "error", err?.message || String(err));
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function startJob({
  script,
  config,
  resume = true,
  forceStoryboard = false,
  forceAll = false,
  seriesTitle = "",
  seriesTagline = "",
  source = "ui",
}) {
  if (activeJob) throw new Error("已有任务在运行");
  const input = config || {};
  const inputUi = input.ui && typeof input.ui === "object" ? input.ui : {};
  const inputLayout = normalizeLayoutConfig(
    inputUi.layout && typeof inputUi.layout === "object"
      ? inputUi.layout
      : { layout: inputUi.layout, avatarVideo: inputUi.avatarVideo, avatarHeight: inputUi.avatarHeight },
  );
  const candidateDigitalHuman = normalizeDigitalHuman(inputUi.digitalHuman, inputLayout);
  if (candidateDigitalHuman.enabled) {
    if (!candidateDigitalHuman.reference && inputLayout.avatar.src) {
      candidateDigitalHuman.reference = inputLayout.avatar.src;
    }
    const ref = path.isAbsolute(candidateDigitalHuman.reference)
      ? candidateDigitalHuman.reference
      : path.resolve(PIPELINE_ROOT, candidateDigitalHuman.reference || "");
    if (!fileOk(ref, 1024)) throw new Error("数字人参考视频不存在，请先在创作输入里选择视频素材");
    if (!DH_VIDEO_EXTS.has(path.extname(ref).toLowerCase())) throw new Error("数字人参考必须是视频文件");
  }
  const saved = saveConfig(input);
  const digitalHuman = saved.ui.digitalHuman || candidateDigitalHuman;
  const providerCfg = saved.tts[saved.tts.provider] || {};
  const builtinVoice = saved.tts.provider === "edge"
    || (saved.tts.provider === "cosyvoice" && String(providerCfg.mode || "").toLowerCase() === "sft");
  if (!builtinVoice) {
    const voiceValue = saved.tts.provider === "indextts" || saved.tts.provider === "kaggle"
      ? providerCfg.promptWav
      : providerCfg.refWav;
    const voiceFile = voiceValue
      ? (path.isAbsolute(voiceValue) ? voiceValue : path.resolve(PIPELINE_ROOT, voiceValue))
      : "";
    if (!voiceFile || !fileOk(voiceFile, 1024)) {
      throw new Error("缺少样本声音：请先在首次配置中上传或选择你自己的声音");
    }
  }
  const text = (script || loadScript()).trim();
  if (!text) throw new Error("文案为空");
  fs.mkdirSync(path.dirname(SCRIPT_FILE), { recursive: true });
  fs.writeFileSync(SCRIPT_FILE, text + "\n", "utf8");
  if (seriesTitle || seriesTagline) saveSeries(seriesTitle, seriesTagline);

  const id = stamp();
  const dir = path.join(RUNS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "script.txt"), text + "\n", "utf8");
  writeJson(path.join(dir, "config.json"), { tts: saved.tts, ui: saved.ui });

  const outputRel = path.relative(PIPELINE_ROOT, dir).replaceAll("\\", "/");
  const job = {
    id,
    dir,
    outputRel,
    status: "running",
    running: true,
    source: source === "agent" ? "agent" : "ui",
    seriesTitle: String(seriesTitle || "").slice(0, 40),
    seriesTagline: String(seriesTagline || "").slice(0, 80),
    startedAt: Date.now(),
    finishedAt: null,
    progress: 0,
    stage: 0,
    note: "准备中",
    provider: saved.tts.provider,
    styleId: saved.ui.styleId,
    duration: null,
    size: null,
    finalVideo: null,
    error: "",
    cancelRequested: false,
    vsStarted: false,
    segmentTotal: 0,
    scriptPreview: text.replace(/\s+/g, " ").slice(0, 80),
    config: saved.tts,
    ui: saved.ui,
    reusedStages: [],
    reuseVoiceFrom: null,
    stages: buildStages(digitalHuman.enabled).map((stage) => ({
      id: stage.id,
      name: stage.name,
      weight: stage.weight,
      status: "queued",
      progress: 0,
      startedAt: null,
      finishedAt: null,
    })),
    digitalHuman,
    logs: [],
  };
  prepareJobReuse(job, { resume, forceStoryboard, forceAll });
  fs.writeFileSync(path.join(dir, "run.log"), "", "utf8");
  persist(job);
  currentJob = job;
  activeJob = job;
  broadcastState();
  executeJob(job);
  return job;
}

function startAgentJob(spec = {}) {
  let text = String(spec.script || "").trim();
  if (!text && spec.scriptFile) {
    const file = path.resolve(PIPELINE_ROOT, String(spec.scriptFile));
    if (!file.startsWith(PIPELINE_ROOT)) throw new Error("scriptFile 必须位于项目内");
    if (!fileOk(file, 2)) throw new Error(`找不到文案文件：${spec.scriptFile}`);
    text = fs.readFileSync(file, "utf8").trim();
  }
  if (!text) throw new Error("Job Spec 缺少 script 或 scriptFile");
  const base = ttsMerged();
  const prevUi = readJson(UI_CONFIG, {});
  const provider = PROVIDER_IDS.has(spec.provider) ? spec.provider : base.provider || "voicestudio";
  const uiIn = spec.ui && typeof spec.ui === "object" ? spec.ui : {};
  const prevAi = privateAi() || readJson(AI_CONFIG, {});
  const aiIn = spec.ai && typeof spec.ai === "object" ? spec.ai : {};
  const brief = String(spec.aiBrief || aiIn.brief || "").trim();
  const styleId = uiIn.styleId || spec.styleId || prevUi.styleId;
  const motion = uiIn.motion || spec.motion || prevUi.motion;
  const gap = Number(spec.gapSeconds ?? uiIn.gap ?? base.gapSeconds ?? 0.26);
  const config = {
    provider,
    voice: String(spec.voice || ""),
    gapSeconds: gap,
    ui: {
      styleId: STYLE_IDS.has(styleId) ? styleId : "amber",
      motion: MOTION_IDS.has(motion) ? motion : "standard",
      layout: spec.layout && typeof spec.layout === "object" ? spec.layout : uiIn.layout || prevUi.layout,
      digitalHuman: spec.digitalHuman && typeof spec.digitalHuman === "object"
        ? spec.digitalHuman
        : uiIn.digitalHuman || prevUi.digitalHuman,
      gap,
      leadIn: Number(spec.leadIn ?? uiIn.leadIn ?? prevUi.leadIn ?? 0.25),
      tighten: spec.tighten !== false && uiIn.tighten !== false,
    },
    ai: {
      ...prevAi,
      ...aiIn,
      enabled: brief ? true : aiIn.enabled !== false && (aiIn.enabled === true || prevAi.enabled === true),
      extraPrompt: [prevAi.extraPrompt, brief].filter(Boolean).join("；").slice(0, 800),
    },
    kaggle: spec.tts?.kaggle,
    cosyvoice: spec.tts?.cosyvoice,
    voicestudio: spec.tts?.voicestudio,
    local3: spec.tts?.local3,
    indextts: spec.tts?.indextts,
    edge: spec.tts?.edge,
  };
  return startJob({
    script: text,
    config,
    resume: spec.resume !== false,
    forceStoryboard: spec.forceStoryboard === true || spec.forceAll === true,
    forceAll: spec.forceAll === true,
    seriesTitle: spec.seriesTitle || "",
    seriesTagline: spec.seriesTagline || "",
    source: "agent",
  });
}

function listRuns() {
  try {
    return fs.readdirSync(RUNS_DIR)
      .map((id) => readJson(path.join(RUNS_DIR, id, "job.json"), null))
      .filter(Boolean)
      .map((job) => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        provider: job.provider,
        styleId: job.styleId,
        duration: job.duration,
        size: job.size,
        error: job.error || "",
        scriptPreview: job.scriptPreview || "",
        progress: job.progress || 0,
      }))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  } catch {
    return [];
  }
}

function renderSummary() {
  const props = readJson(path.join(PIPELINE_ROOT, "output", "props.json"), null);
  const scenes = props?.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) return null;
  const fps = Number(props?.meta?.fps) || 30;
  const frames = scenes.reduce((sum, s) => sum + (Number(s.durationInFrames) || 0), 0);
  const seconds = Number(props?.meta?.totalSeconds) || frames / fps;
  const photoLayouts = new Set(["hero", "band", "number", "closing"]);
  return {
    scenes: scenes.length,
    photos: scenes.filter((s) => s.photo && photoLayouts.has(s.layout)).length,
    seconds: Math.round(seconds * 10) / 10,
    layouts: scenes.map((s) => s.layout),
    planner: props?.meta?.planner || "heuristic",
    builtAt: props?.meta?.createdAt || null,
  };
}

function workbuddyCandidates() {
  const home = os.homedir();
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  return [
    process.env.OD_WORKBUDDY_MODELS,
    path.join(home, ".workbuddy", "models.json"),
    path.join(home, ".workbuddy-ai", "models.json"),
    ...(appData ? [path.join(appData, "WorkBuddy", "models.json"), path.join(appData, "workbuddy", "models.json")] : []),
    ...(localAppData ? [path.join(localAppData, "WorkBuddy", "models.json")] : []),
  ].filter(Boolean);
}

function collectWorkbuddyModels(data) {
  const out = [];
  const seen = new Set();
  const add = (entry, inherited = {}) => {
    if (!entry || typeof entry !== "object") return;
    const model = String(entry.model || entry.modelId || entry.id || entry.name || "").trim();
    const baseUrl = String(entry.baseUrl || entry.base_url || entry.endpoint || inherited.baseUrl || "").trim().replace(/\/+$/, "");
    if (!model || !/^https?:\/\//i.test(baseUrl)) return;
    const key = `${baseUrl}|${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `wb-${out.length}`,
      name: String(entry.label || entry.name || inherited.label || model).slice(0, 60),
      model,
      baseUrl,
      apiKey: String(entry.apiKey || entry.api_key || entry.key || inherited.apiKey || ""),
    });
  };
  const walk = (node, inherited = {}, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inherited, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const baseUrl = node.baseUrl || node.base_url || node.endpoint || inherited.baseUrl;
    const apiKey = node.apiKey || node.api_key || node.key || inherited.apiKey;
    const label = node.label || node.name || inherited.label;
    if (node.models && Array.isArray(node.models)) {
      for (const item of node.models) {
        if (typeof item === "string") add({ model: item }, { baseUrl, apiKey, label });
        else add(item, { baseUrl, apiKey, label });
      }
    }
    if (typeof node.model === "string") add(node, { baseUrl, apiKey, label });
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walk(value, { baseUrl, apiKey, label }, depth + 1);
    }
  };
  walk(data);
  return out;
}

function readWorkbuddyModels() {
  for (const file of workbuddyCandidates()) {
    if (!fileOk(file, 2)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      const models = collectWorkbuddyModels(data);
      if (models.length) return { found: true, file, models };
      return { found: true, file, models: [] };
    } catch {
      return { found: true, file, models: [], error: "models.json 解析失败" };
    }
  }
  return { found: false, file: "", models: [] };
}

function workbuddyPublic() {
  const data = readWorkbuddyModels();
  return {
    found: data.found,
    file: data.file,
    error: data.error || "",
    models: data.models.map(({ id, name, model, baseUrl }) => ({ id, name, model, baseUrl })),
  };
}

function setupDetect() {
  const local = privatePaths();
  const candidates = [
    { key: "python", label: "Python", values: [local.python, venvPython(path.join(PIPELINE_ROOT, ".venv")), process.env.OD_PYTHON].filter(Boolean) },
    { key: "ffmpeg", label: "FFmpeg", values: [local.ffmpeg, "ffmpeg"] },
    { key: "chrome", label: "Chrome", values: chromeCandidates(local.chrome) },
    { key: "modelsRoot", label: "模型目录", values: [local.modelsRoot, path.join(PIPELINE_ROOT, "models")] },
    { key: "vendorRoot", label: "依赖目录", values: [local.vendorRoot, path.join(PIPELINE_ROOT, "vendor")] },
    { key: "voiceStudioRoot", label: "VoiceStudio", values: [local.voiceStudioRoot, path.join(PIPELINE_ROOT, "vendor", "VoiceStudio")] },
    { key: "cosyvoiceVendor", label: "CosyVoice", values: [local.cosyvoiceVendor, path.join(PIPELINE_ROOT, "vendor", "CosyVoice")] },
    { key: "indexttsRepo", label: "IndexTTS", values: [local.indexttsRepo, path.join(PIPELINE_ROOT, "vendor", "indextts")] },
    { key: "kagglePython", label: "Kaggle Python", values: [local.kagglePython, venvPython(path.join(PIPELINE_ROOT, "pipeline", "tts", ".venv-kaggle"))] },
    { key: "kaggleBin", label: "Kaggle CLI", values: [local.kaggleBin, venvPython(path.join(PIPELINE_ROOT, "pipeline", "tts", ".venv-kaggle"), "kaggle")] },
  ];
  const paths = {};
  for (const item of candidates) {
    const hit = item.values.find((value) => value && (value === "ffmpeg" || value === "ffprobe" || fs.existsSync(value)));
    paths[item.key] = hit || item.values[0] || "";
  }
  return {
    paths,
    workbuddy: workbuddyPublic(),
    setup: setupState(),
    env: envStatus(ttsMerged()),
  };
}

function saveSetup(body = {}) {
  const pathsIn = body.paths && typeof body.paths === "object" ? body.paths : {};
  const paths = {};
  for (const key of ["python", "ffmpeg", "ffprobe", "chrome", "modelsRoot", "vendorRoot", "cosyvoiceVendor", "cosyvoiceModel", "voiceStudioRoot", "indexttsRepo", "indexttsPython", "indexttsModel", "kagglePython", "kaggleBin", "kaggleConfigDir", "voiceRef"]) {
    if (pathsIn[key] !== undefined) paths[key] = String(pathsIn[key] || "").trim();
  }
  const patch = {
    version: 1,
    setupCompleted: true,
    source: String(body.source || "manual").slice(0, 20),
    paths,
  };
  const ttsIn = body.tts && typeof body.tts === "object" ? body.tts : null;
  if (ttsIn) {
    patch.tts = {};
    if (PROVIDER_IDS.has(ttsIn.provider)) patch.tts.provider = ttsIn.provider;
    for (const provider of PROVIDER_IDS) {
      if (ttsIn[provider] && typeof ttsIn[provider] === "object") {
        patch.tts[provider] = { ...ttsIn[provider] };
      }
    }
  }
  if (body.kaggle && typeof body.kaggle === "object") {
    const prev = readPrivate().kaggle || {};
    const k = body.kaggle;
    patch.kaggle = {
      ...prev,
      username: String(k.username ?? prev.username ?? "").trim().slice(0, 80),
      cli: String(k.cli ?? prev.cli ?? "").trim().slice(0, 300),
      dataset: String(k.dataset ?? prev.dataset ?? "").trim().slice(0, 120),
      kernel: String(k.kernel ?? prev.kernel ?? "latentsync-dual").trim().slice(0, 80) || "latentsync-dual",
      accelerator: String(k.accelerator ?? prev.accelerator ?? "NvidiaTeslaT4").trim().slice(0, 60) || "NvidiaTeslaT4",
      timeoutMin: Math.round(clampNum(k.timeoutMin ?? prev.timeoutMin, 10, 360, 120)),
    };
    const key = String(k.key || "").trim();
    const token = String(k.token || "").trim();
    if (key) patch.kaggle.key = key;
    if (token) patch.kaggle.token = token;
  }
  if (body.ai && typeof body.ai === "object") {
    const prev = privateAi() || readJson(AI_CONFIG, {});
    const key = String(body.ai.apiKey || "").trim();
    patch.ai = sanitizeAi({ ...prev, ...body.ai, apiKey: key || prev.apiKey || "" });
  }
  writePrivate(patch);
  return { setup: setupState(), env: envStatus(ttsMerged()), workbuddy: workbuddyPublic() };
}

function applyWorkbuddyModel(id) {
  const data = readWorkbuddyModels();
  const model = data.models.find((item) => item.id === String(id || ""));
  if (!model) throw new Error("WorkBuddy 模型不存在或已变化");
  const ai = sanitizeAi({
    ...(privateAi() || {}),
    enabled: true,
    baseUrl: model.baseUrl,
    model: model.model,
    apiKey: model.apiKey,
    source: "workbuddy",
  });
  writePrivate({ ai: { ...ai, source: "workbuddy" }, source: "workbuddy", setupCompleted: true });
  return { ai: maskAi(ai), workbuddy: workbuddyPublic() };
}

function bootstrap() {
  hydrateGlobalFromLatestRun();
  const { tts, ui, ai } = currentConfigs();
  const runs = listRuns();
  const latest = currentJob ? publicJob(currentJob) : (runs[0] ? readJson(path.join(RUNS_DIR, runs[0].id, "job.json"), null) : null);
  return {
    pipelineRoot: PIPELINE_ROOT,
    setup: setupState(),
    workbuddy: workbuddyPublic(),
    env: envStatus(tts),
    config: { ...tts, ui, ai },
    script: loadScript(),
    series: loadSeries(),
    voices: listVoices(),
    avatars: listAvatars(),
    materials: listMaterials(),
    layoutPresets: readPresets(),
    motion: motionState(),
    prep: prepState(),
    runPlan: computeRunPlan(tts, ui),
    runs,
    render: renderSummary(),
    active: activeJob ? publicJob(activeJob) : null,
    latest,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function safeFile(base, name) {
  const clean = path.basename(String(name || ""));
  if (!clean || clean !== String(name)) return null;
  const file = path.join(base, clean);
  return fileOk(file) ? file : null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".srt": "text/plain; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function serveFile(req, res, file, download = false) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const range = req.headers.range;
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${path.basename(file)}"`;
  if (req.method === "HEAD") {
    headers["Content-Length"] = stat.size;
    res.writeHead(200, headers);
    res.end();
    return;
  }
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  headers["Content-Length"] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if ((pathname === "/" || pathname === "/index.html") && !setupState().completed) {
      res.writeHead(302, { Location: "/setup" });
      res.end();
      return;
    }

    if (pathname === "/api/bootstrap" && req.method === "GET") {
      sendJson(res, 200, bootstrap());
      return;
    }

    if (pathname === "/api/setup" && req.method === "GET") {
      sendJson(res, 200, { ...setupState(), workbuddy: workbuddyPublic() });
      return;
    }

    if (pathname === "/api/setup" && req.method === "POST") {
      const body = await readBody(req);
      const result = saveSetup(body);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/setup/detect" && (req.method === "GET" || req.method === "POST")) {
      sendJson(res, 200, setupDetect());
      return;
    }

    if (pathname === "/api/setup/workbuddy" && req.method === "GET") {
      sendJson(res, 200, workbuddyPublic());
      return;
    }

    if (pathname === "/api/setup/workbuddy/import" && req.method === "POST") {
      const body = await readBody(req);
      try {
        sendJson(res, 200, applyWorkbuddyModel(body.id));
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, currentConfigs());
      return;
    }

    if (pathname === "/api/config" && req.method === "POST") {
      const body = await readBody(req);
      const saved = saveConfig(body);
      sendJson(res, 200, saved);
      return;
    }

    if (pathname === "/api/voicestudio/status" && req.method === "GET") {
      sendJson(res, 200, await probeVoiceStudio());
      return;
    }

    if (pathname === "/api/voicestudio/start" && req.method === "POST") {
      const current = await probeVoiceStudio();
      if (current.ok) {
        sendJson(res, 200, current);
        return;
      }
      const launch = launchVoiceStudio();
      if (!launch.ok) {
        sendJson(res, 500, { ok: false, text: launch.error });
        return;
      }
      let status = await probeVoiceStudio();
      for (let i = 0; i < 40 && !status.ok; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        status = await probeVoiceStudio();
      }
      sendJson(res, 200, status);
      return;
    }

    if (pathname === "/api/script" && req.method === "GET") {
      sendJson(res, 200, { script: loadScript() });
      return;
    }

    if (pathname === "/api/script" && req.method === "POST") {
      const body = await readBody(req);
      const text = String(body.script ?? "").trimEnd();
      fs.mkdirSync(path.dirname(SCRIPT_FILE), { recursive: true });
      fs.writeFileSync(SCRIPT_FILE, text + "\n", "utf8");
      sendJson(res, 200, { ok: true, chars: text.length });
      return;
    }

    if (pathname === "/api/series" && req.method === "GET") {
      sendJson(res, 200, loadSeries());
      return;
    }

    if (pathname === "/api/series" && req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, ...saveSeries(body.title, body.tagline) });
      return;
    }

    if (pathname === "/api/voices/upload" && req.method === "POST") {
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > MAX_VOICE_BYTES) {
        sendJson(res, 413, { error: "文件超过 40MB" });
        return;
      }
      let original = "voice-upload";
      try {
        original = decodeURIComponent(String(req.headers["x-file-name"] || "voice-upload"));
      } catch {
        original = "voice-upload";
      }
      const ext = path.extname(original).toLowerCase();
      if (!VOICE_EXTS.has(ext)) {
        sendJson(res, 400, { error: "仅支持 wav / mp3 / m4a / flac" });
        return;
      }
      const buffer = await readRawBody(req, MAX_VOICE_BYTES);
      if (!buffer.length) {
        sendJson(res, 400, { error: "文件为空" });
        return;
      }
      fs.mkdirSync(VOICE_DIR, { recursive: true });
      const name = `_upload-${Date.now()}${ext}`;
      const file = path.join(VOICE_DIR, name);
      fs.writeFileSync(file, buffer);
      try {
        const duration = probeDuration(file);
        if (duration < 0.4) throw new Error("音频太短，至少需要 0.4 秒");
        sendJson(res, 200, { name, original: path.basename(original), duration, size: buffer.length });
      } catch (err) {
        fs.rmSync(file, { force: true });
        throw err;
      }
      return;
    }

    if (pathname === "/api/voices/clip" && req.method === "POST") {
      const body = await readBody(req);
      const input = safeFile(VOICE_DIR, body.name);
      if (!input) {
        sendJson(res, 404, { error: "音色文件不存在" });
        return;
      }
      const total = probeDuration(input);
      const start = Math.min(Math.max(Number(body.start) || 0, 0), Math.max(0, total - 0.4));
      const requested = Number(body.duration) || 10;
      const length = Math.min(Math.max(requested, 0.4), 12, total - start);
      if (length < 0.4) {
        sendJson(res, 400, { error: "截取片段太短" });
        return;
      }
      const outName = `voice-${stamp()}-${String(Math.floor(Math.random() * 900) + 100)}.wav`;
      const outFile = path.join(VOICE_DIR, outName);
      execFileSync(
        "ffmpeg",
        ["-y", "-v", "error", "-i", input, "-ss", String(start), "-t", String(length), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outFile],
        { timeout: 60000, windowsHide: true },
      );
      if (!fileOk(outFile, 1024)) throw new Error("截取失败，请重试");
      if (path.basename(input).startsWith("_upload-")) fs.rmSync(input, { force: true });
      sendJson(res, 200, {
        name: outName,
        path: publicVoicePath(outFile),
        duration: probeDuration(outFile),
        size: fs.statSync(outFile).size,
        start,
        length,
      });
      return;
    }

    const deleteVoiceMatch = pathname.match(/^\/api\/voices\/([^/]+)$/);
    if (deleteVoiceMatch && req.method === "DELETE") {
      const name = decodeURIComponent(deleteVoiceMatch[1]);
      if (!name.startsWith("_upload-")) {
        sendJson(res, 400, { error: "只能清理上传中的临时音色" });
        return;
      }
      const file = safeFile(VOICE_DIR, name);
      if (file) fs.rmSync(file, { force: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/avatars" && req.method === "GET") {
      sendJson(res, 200, { avatars: listAvatars() });
      return;
    }

    if (pathname === "/api/avatars/upload" && req.method === "POST") {
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > MAX_AVATAR_BYTES) {
        sendJson(res, 413, { error: "文件超过 120MB" });
        return;
      }
      let original = "avatar";
      try {
        original = decodeURIComponent(String(req.headers["x-file-name"] || "avatar"));
      } catch {
        original = "avatar";
      }
      const ext = path.extname(original).toLowerCase();
      if (!AVATAR_EXTS.has(ext)) {
        sendJson(res, 400, { error: "仅支持 png / jpg / webp / mp4 / webm / mov" });
        return;
      }
      const buffer = await readRawBody(req, MAX_AVATAR_BYTES);
      if (!buffer.length) {
        sendJson(res, 400, { error: "文件为空" });
        return;
      }
      fs.mkdirSync(AVATAR_DIR, { recursive: true });
      const name = `${stamp()}-${String(Math.floor(Math.random() * 900) + 100)}${ext}`;
      fs.writeFileSync(path.join(AVATAR_DIR, name), buffer);
      sendJson(res, 200, { name, src: avatarSrc(name), size: buffer.length, avatars: listAvatars() });
      return;
    }

    if (pathname === "/api/materials" && req.method === "GET") {
      sendJson(res, 200, listMaterials());
      return;
    }

    if (pathname === "/api/materials/upload" && req.method === "POST") {
      const declared = Number(req.headers["content-length"] || 0);
      if (declared > MAX_MATERIAL_BYTES) {
        sendJson(res, 413, { error: "单张图片不能超过 40MB" });
        return;
      }
      let original = "material";
      try {
        original = path.basename(decodeURIComponent(String(req.headers["x-file-name"] || "material")));
      } catch {
        original = "material";
      }
      const ext = path.extname(original).toLowerCase();
      if (!MATERIAL_EXTS.has(ext)) {
        sendJson(res, 400, { error: "仅支持 png / jpg / jpeg / webp" });
        return;
      }
      let chapterOverride = "";
      try {
        chapterOverride = decodeURIComponent(String(req.headers["x-chapter"] || "")).trim();
      } catch {
        chapterOverride = "";
      }
      const buffer = await readRawBody(req, MAX_MATERIAL_BYTES);
      if (!buffer.length) {
        sendJson(res, 400, { error: "文件为空" });
        return;
      }
      fs.mkdirSync(MATERIAL_DIR, { recursive: true });
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
      const key = `custom-${crypto.createHash("sha1").update(`${original}-${Date.now()}-${Math.random()}`).digest("hex").slice(0, 10)}`;
      const file = `${key}${ext}`;
      fs.writeFileSync(path.join(MATERIAL_DIR, file), buffer);
      fs.copyFileSync(path.join(MATERIAL_DIR, file), path.join(PHOTO_DIR, file));
      const items = readMaterialManifest();
      const item = {
        id: key,
        key,
        file,
        name: original,
        chapter: chapterOverride || detectMaterialChapter(original),
        size: buffer.length,
        mtime: Date.now(),
        createdAt: Date.now(),
      };
      items.push(item);
      writeMaterialManifest(items);
      sendJson(res, 200, { item: publicMaterial(item), ...listMaterials() });
      return;
    }

    if (pathname === "/api/materials/update" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || body.key || "");
      const items = readMaterialManifest();
      const item = items.find((entry) => entry.id === id || entry.key === id);
      if (!item) {
        sendJson(res, 404, { error: "素材不存在" });
        return;
      }
      if (typeof body.name === "string") {
        const base = body.name.trim().replace(/\.[^./\\]+$/, "").slice(0, 110).trim();
        if (base) {
          const ext = path.extname(item.name) || path.extname(item.file) || "";
          item.name = `${base}${ext}`;
          const detected = detectMaterialChapter(base, knownMaterialChapters());
          if (detected !== "未分章") item.chapter = detected;
        }
      }
      if (typeof body.chapter === "string") {
        item.chapter = body.chapter.trim().slice(0, 40) || "未分章";
      }
      writeMaterialManifest(items);
      sendJson(res, 200, listMaterials());
      return;
    }

    if (pathname === "/api/materials/delete" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.id || body.key || "");
      const items = readMaterialManifest();
      const item = items.find((entry) => entry.id === id || entry.key === id);
      if (!item) {
        sendJson(res, 404, { error: "素材不存在" });
        return;
      }
      removeMaterialFiles(item);
      writeMaterialManifest(items.filter((entry) => entry !== item));
      sendJson(res, 200, listMaterials());
      return;
    }

    if (pathname === "/api/materials/redetect" && req.method === "POST") {
      const items = readMaterialManifest();
      for (const item of items) item.chapter = detectMaterialChapter(item.name, knownMaterialChapters(false));
      writeMaterialManifest(items);
      sendJson(res, 200, listMaterials());
      return;
    }

    if (pathname === "/api/storyboard" && req.method === "GET") {
      const { tts, ui } = currentConfigs();
      sendJson(res, 200, {
        ...storyboardStatus(),
        prep: prepState(),
        scenes: sceneList(),
        materials: listMaterials(),
        runPlan: computeRunPlan(tts, ui),
      });
      return;
    }

    if (pathname === "/api/storyboard/generate" && req.method === "POST") {
      const body = await readBody(req);
      const result = await runStoryboardPrep({
        force: body.force !== false,
        autoMotion: body.autoMotion !== false,
        reason: String(body.reason || ""),
      });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === "/api/layout-presets" && req.method === "GET") {
      sendJson(res, 200, { presets: readPresets() });
      return;
    }

    if (pathname === "/api/layout-presets" && req.method === "POST") {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 40) || "未命名预设";
      const config = normalizeLayoutConfig(body.config || {});
      const list = readPresets();
      const id = typeof body.id === "string" && body.id ? body.id : `p-${Date.now().toString(36)}`;
      const next = {
        id,
        name,
        createdAt: Date.now(),
        config,
      };
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list[index] = next;
      else list.unshift(next);
      writePresets(list);
      sendJson(res, 200, { presets: readPresets(), saved: next });
      return;
    }

    const presetMatch = pathname.match(/^\/api\/layout-presets\/([A-Za-z0-9-]+)$/);
    if (presetMatch && req.method === "DELETE") {
      const list = readPresets().filter((item) => item.id !== presetMatch[1]);
      writePresets(list);
      sendJson(res, 200, { presets: readPresets() });
      return;
    }

    if (pathname === "/api/run" && req.method === "GET") {
      sendJson(res, 200, { job: publicJob(currentJob), running: Boolean(activeJob) });
      return;
    }

    if (pathname === "/api/motion" && req.method === "GET") {
      sendJson(res, 200, motionState());
      return;
    }

    if (pathname === "/api/motion/generate" && req.method === "POST") {
      const body = await readBody(req);
      const prompt = String(body.prompt || "").trim();
      if (prompt.length < 2) {
        sendJson(res, 400, { error: "先写一句动效需求" });
        return;
      }
      const scenes = sceneList();
      const index = Math.max(0, Math.min(scenes.length - 1, Math.round(Number(body.sceneIndex) || 0)));
      const scene = scenes[index] || null;
      const result = await motionLib.generateMotionRecipes({
        prompt: prompt.slice(0, 400),
        sceneTitle: scene ? scene.title : "",
        layout: scene ? scene.layout : "",
        count: 3,
      });
      if (!result.ok) {
        sendJson(res, 400, { error: result.reason || "生成失败" });
        return;
      }
      const config = motionLib.readMotion();
      const fresh = new Set(result.recipes.map((recipe) => recipe.id));
      const used = new Set(Object.values(config.assignments).filter(Boolean));
      for (const rid of Object.keys(config.recipes)) {
        if (!fresh.has(rid) && !used.has(rid)) delete config.recipes[rid];
      }
      for (const recipe of result.recipes) config.recipes[recipe.id] = recipe;
      motionLib.writeMotion(config);
      sendJson(res, 200, {
        recipes: result.recipes,
        fallback: Boolean(result.fallback),
        model: result.model || null,
        reason: result.reason || null,
        motion: motionState(),
      });
      return;
    }

    if (pathname === "/api/motion/apply" && req.method === "POST") {
      const body = await readBody(req);
      try {
        sendJson(res, 200, applyMotion(body));
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/motion/reset" && req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, resetMotion(body));
      return;
    }

    if (pathname === "/api/motion/auto" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const result = await autoMotionAction(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/motion/lock" && req.method === "POST") {
      const body = await readBody(req);
      try {
        sendJson(res, 200, lockMotion(body));
      } catch (err) {
        sendJson(res, 409, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/motion/scene" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const result = await regenerateSceneAction(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/scene/photo" && req.method === "POST") {
      const body = await readBody(req);
      try {
        if (activeJob) throw new Error("成片生成中，等结束后再调整配图");
        const scene = await setScenePhotoSource(body.sceneId, String(body.source || ""));
        sendJson(res, 200, { ok: true, sceneId: scene.id, photoSource: scene.photoSource, motion: motionState() });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/layout/templates" && req.method === "GET") {
      sendJson(res, 200, { templates: readLayoutTemplates() });
      return;
    }

    if (pathname === "/api/layout/templates" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const result = saveLayoutTemplate(body);
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/layout/templates/delete" && req.method === "POST") {
      const body = await readBody(req);
      try {
        sendJson(res, 200, { ok: true, templates: deleteLayoutTemplate(body.id) });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/layout/templates/apply" && req.method === "POST") {
      const body = await readBody(req);
      try {
        if (activeJob) throw new Error("成片生成中，先等这次跑完再套用模板");
        const result = applyLayoutTemplate(body.id, body.sceneId);
        sendJson(res, 200, {
          ok: true,
          sceneId: result.scene.id,
          layoutStyle: result.style,
          template: result.template,
          motion: motionState(),
        });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/scene/layout" && req.method === "POST") {
      const body = await readBody(req);
      try {
        if (activeJob) throw new Error("成片生成中，先等这次跑完再调整布局");
        const result = setSceneLayout(String(body.sceneId || ""), body.layoutStyle || {});
        sendJson(res, 200, {
          ok: true,
          sceneId: result.scene.id,
          layoutStyle: result.style,
          key: result.key,
          motion: motionState(),
        });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/motion/preview" && req.method === "POST") {
      const body = await readBody(req);
      if (activeJob) {
        sendJson(res, 409, { error: "流水线运行中，稍后再试" });
        return;
      }
      try {
        requireFreshStoryboard();
      } catch (err) {
        sendJson(res, 409, { error: err?.message || String(err) });
        return;
      }
      try {
        const result = await renderMotionPreviews(body.sceneIndex);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err?.message || String(err) });
      }
      return;
    }

    const motionPreviewMatch = pathname.match(/^\/api\/motion\/preview\/([^/]+\.png)$/);
    if (motionPreviewMatch && (req.method === "GET" || req.method === "HEAD")) {
      const file = safeFile(PREVIEW_DIR, motionPreviewMatch[1]);
      if (!file) {
        sendJson(res, 404, { error: "预览不存在" });
        return;
      }
      serveFile(req, res, file);
      return;
    }

    if (pathname === "/api/agent/run" && req.method === "POST") {
      if (activeJob) {
        sendJson(res, 409, { error: "已有任务在运行" });
        return;
      }
      if (storyboardPrep?.state === "running") {
        sendJson(res, 409, { error: "分镜正在生成，请稍候再开始" });
        return;
      }
      const body = await readBody(req);
      try {
        const job = startAgentJob(body);
        sendJson(res, 202, {
          ok: true,
          id: job.id,
          source: "agent",
          reusedStages: job.reusedStages,
          outputDir: job.dir,
        });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/run" && req.method === "POST") {
      if (activeJob) {
        sendJson(res, 409, { error: "已有任务在运行" });
        return;
      }
      if (storyboardPrep?.state === "running") {
        sendJson(res, 409, { error: "分镜正在生成，请稍候再开始" });
        return;
      }
      const body = await readBody(req);
      try {
        const job = startJob(body);
        sendJson(res, 202, { id: job.id, reusedStages: job.reusedStages, reuseVoiceFrom: job.reuseVoiceFrom });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || String(err) });
      }
      return;
    }

    if (pathname === "/api/run/cancel" && req.method === "POST") {
      if (!activeJob) {
        sendJson(res, 409, { error: "当前没有运行中的任务" });
        return;
      }
      activeJob.cancelRequested = true;
      killTree(activeJob);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/runs" && req.method === "GET") {
      sendJson(res, 200, { runs: listRuns() });
      return;
    }

    const runMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)$/);
    if (runMatch && req.method === "GET") {
      const dir = path.join(RUNS_DIR, runMatch[1]);
      const job = readJson(path.join(dir, "job.json"), null);
      if (!job) {
        sendJson(res, 404, { error: "任务不存在" });
        return;
      }
      const config = readJson(path.join(dir, "config.json"), null);
      const script = fs.existsSync(path.join(dir, "script.txt")) ? fs.readFileSync(path.join(dir, "script.txt"), "utf8") : "";
      sendJson(res, 200, { job: publicJob(job), config, script });
      return;
    }

    if (runMatch && req.method === "DELETE") {
      if (activeJob && activeJob.id === runMatch[1]) {
        sendJson(res, 409, { error: "任务运行中，无法删除" });
        return;
      }
      const dir = path.join(RUNS_DIR, runMatch[1]);
      if (!fs.existsSync(dir)) {
        sendJson(res, 404, { error: "任务不存在" });
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      if (currentJob?.id === runMatch[1]) currentJob = null;
      sendJson(res, 200, { ok: true });
      return;
    }

    const logMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)\/log$/);
    if (logMatch && req.method === "GET") {
      const file = path.join(RUNS_DIR, logMatch[1], "run.log");
      if (!fileOk(file)) {
        sendJson(res, 404, { error: "日志不存在" });
        return;
      }
      serveFile(req, res, file, true);
      return;
    }

    const revealMatch = pathname.match(/^\/api\/runs\/([A-Za-z0-9-]+)\/reveal$/);
    if (revealMatch && req.method === "POST") {
      const dir = path.join(RUNS_DIR, revealMatch[1]);
      if (!fs.existsSync(dir)) {
        sendJson(res, 404, { error: "任务不存在" });
        return;
      }
      execFile("explorer.exe", [dir], { windowsHide: true }, () => {});
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
    const snapshot = {
      job: publicJob(currentJob),
      logs: currentJob ? currentJob.logs.slice(-300) : [],
      running: Boolean(activeJob),
      prep: prepState(),
    };
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      const timer = setInterval(() => {
        try {
          res.write("event: ping\ndata: {}\n\n");
        } catch {}
      }, 15000);
      req.on("close", () => {
        clearInterval(timer);
        clients.delete(res);
      });
      return;
    }

    const mediaMatch = pathname.match(/^\/media\/run\/([A-Za-z0-9-]+)\/([^/]+)$/);
    if (mediaMatch && (req.method === "GET" || req.method === "HEAD")) {
      const allowed = new Set(["final.mp4", "voice.wav", "slides.mp4", "subtitles.srt", "subtitles.ass", "timeline.json", "props.json", "slides.json", "run.log"]);
      if (!allowed.has(mediaMatch[2])) {
        sendJson(res, 404, { error: "文件不可用" });
        return;
      }
      const file = safeFile(path.join(RUNS_DIR, mediaMatch[1]), mediaMatch[2]);
      if (!file) {
        sendJson(res, 404, { error: "文件不存在" });
        return;
      }
      const download = mediaMatch[2] === "final.mp4" && url.searchParams.get("download") === "1";
      serveFile(req, res, file, download);
      return;
    }

    const voiceMatch = pathname.match(/^\/media\/voice\/([^/]+)$/);
    if (voiceMatch && req.method === "GET") {
      const file = safeFile(VOICE_DIR, voiceMatch[1]);
      if (!file) {
        sendJson(res, 404, { error: "音色不存在" });
        return;
      }
      serveFile(req, res, file);
      return;
    }

    const avatarMediaMatch = pathname.match(/^\/(?:media|assets)\/avatar\/([^/]+)$/);
    if (avatarMediaMatch && (req.method === "GET" || req.method === "HEAD")) {
      const file = safeFile(AVATAR_DIR, avatarMediaMatch[1]);
      if (!file) {
        sendJson(res, 404, { error: "头像不存在" });
        return;
      }
      serveFile(req, res, file);
      return;
    }

    const photoMediaMatch = pathname.match(/^\/media\/photos\/([^/]+)$/);
    if (photoMediaMatch && (req.method === "GET" || req.method === "HEAD")) {
      const file = safeFile(PHOTO_DIR, photoMediaMatch[1]);
      if (!file) {
        sendJson(res, 404, { error: "配图不存在" });
        return;
      }
      serveFile(req, res, file);
      return;
    }

    const materialMediaMatch = pathname.match(/^\/media\/materials\/([^/]+)$/);
    if (materialMediaMatch && (req.method === "GET" || req.method === "HEAD")) {
      const file = safeFile(MATERIAL_DIR, materialMediaMatch[1]);
      if (!file) {
        sendJson(res, 404, { error: "素材不存在" });
        return;
      }
      serveFile(req, res, file);
      return;
    }

    if (pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }

    const staticMap = {
      "/": "index.html",
      "/index.html": "index.html",
      "/styles.css": "styles.css",
      "/app.js": "app.js",
      "/setup": "setup.html",
      "/setup.html": "setup.html",
      "/setup.js": "setup.js",
      "/setup.css": "setup.css",
      "/layout-review.html": "layout-review.html",
    };
    if (staticMap[pathname]) {
      const file = path.join(HERE, staticMap[pathname]);
      if (!fileOk(file)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      serveFile(req, res, file);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err?.message || String(err) });
    else res.end();
  }
});

fs.mkdirSync(RUNS_DIR, { recursive: true });
pruneUploads();

let listenPort = PORT;
let portTries = 0;
server.on("listening", () => {
  console.log(`口播工坊控制台: http://${HOST}:${listenPort}`);
  console.log(`流水线目录: ${PIPELINE_ROOT}`);
  probeVoiceStudio();
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && !process.env.OD_UI_PORT && portTries < 20) {
    portTries += 1;
    const next = listenPort + 1;
    console.warn(`端口 ${listenPort} 已被占用，放弃固定端口，改用 ${next}`);
    listenPort = next;
    server.listen(listenPort, HOST);
    return;
  }
  throw err;
});
server.listen(listenPort, HOST);
