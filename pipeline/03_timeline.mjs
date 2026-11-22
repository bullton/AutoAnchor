import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { files, paths, readLayout, shapeRatio, video } from "./config.mjs";
import { fetchMissingPhotos } from "./photos.mjs";
import { readMotion, resolveMotionForScene } from "./motion.mjs";

const slidesPayload = JSON.parse(fs.readFileSync(files.slides, "utf8"));
const timeline = JSON.parse(fs.readFileSync(files.timeline, "utf8"));
const scriptRaw = fs.readFileSync(files.script, "utf8");
const scriptHash = crypto.createHash("sha1").update(scriptRaw.replace(/\s+/g, "")).digest("hex").slice(0, 16);

const byId = new Map(timeline.items.map((item) => [item.id, item]));

let prevFrame = 0;
const timed = slidesPayload.slides.map((slide) => {
  const item = byId.get(slide.id);
  if (!item) throw new Error(`时间轴缺少分镜 ${slide.id}`);
  const frame = Math.round(item.end * video.fps);
  const durationInFrames = Math.max(1, frame - prevFrame);
  prevFrame = frame;
  return { ...slide, audioStart: item.start, audioEnd: item.end, durationInFrames };
});

const uiFile = path.join(paths.root, "pipeline", "ui.json");
const ui = fs.existsSync(uiFile) ? JSON.parse(fs.readFileSync(uiFile, "utf8")) : {};

// ---------- 幕级时间轴（语音驱动） ----------

const photoDir = path.join(paths.root, "assets", "photos");
const photoOut = path.join(paths.remotion, "public", "photos");
const photoExts = [".jpg", ".jpeg", ".png", ".webp"];

function readPhotoManifest() {
  const file = path.join(photoDir, "manifest.json");
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

const photoManifest = readPhotoManifest();
const usedCredits = [];
const missingPhotos = new Set();

// ---------- AI 指定了检索词但本地没有图时，自动补齐 ----------
const fetchRequests = [];
for (const scene of slidesPayload.scenes || []) {
  const key = scene.photoKey;
  if (!key || key === "topic") continue;
  if (fetchRequests.some((item) => item.key === key)) continue;
  if (scene.photoQuery || scene.wikiTitle) fetchRequests.push({ key, query: scene.photoQuery, wikiTitle: scene.wikiTitle });
}
if (fetchRequests.length) {
  console.log(`[03] 配图检查：${fetchRequests.length} 个主题 ${fetchRequests.map((i) => i.key).join(", ")}`);
  try {
    const result = await fetchMissingPhotos(paths.root, fetchRequests, (line) => console.log(line));
    if (result.fetched.length) console.log(`[03] 新抓取 ${result.fetched.length} 张：${result.fetched.join(", ")}`);
    if (result.failed.length) console.log(`[03] 抓取失败 ${result.failed.length} 张：${result.failed.join(", ")}`);
  } catch (err) {
    console.warn(`[03] 自动补图异常：${err?.message || err}`);
  }
}

const photoAspectCache = new Map();

function photoAspectOf(photo) {
  if (!photo) return null;
  if (photoAspectCache.has(photo)) return photoAspectCache.get(photo);
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
  photoAspectCache.set(photo, aspect);
  return aspect;
}

function resolvePhoto(key) {
  if (!key || key === "topic") return null;
  for (const ext of photoExts) {
    const src = path.join(photoDir, `${key}${ext}`);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(photoOut, { recursive: true });
    const name = `${key}${ext}`;
    fs.copyFileSync(src, path.join(photoOut, name));
    const meta = photoManifest[key];
    if (meta && (meta.author || meta.license || meta.source)) {
      usedCredits.push({
        key,
        author: meta.author || "",
        license: meta.license || "",
        source: meta.source || "",
      });
    }
    return `photos/${name}`;
  }
  missingPhotos.add(key);
  return null;
}

let sceneCursor = 0;

// TTS 的分句可能比文案多（逗号/分号也会断句），把没被任何幕认领的句子并到最后一幕，避免成片被截短
const plannedIds = new Set((slidesPayload.scenes || []).flatMap((scene) => scene.lineIds));
const orphanIds = timeline.items.map((item) => item.id).filter((id) => !plannedIds.has(id));
if (orphanIds.length && slidesPayload.scenes?.length) {
  const last = slidesPayload.scenes[slidesPayload.scenes.length - 1];
  last.lineIds = [...last.lineIds, ...orphanIds];
  console.log(`[03] ${orphanIds.length} 句未被分镜认领，并入 ${last.id}：${orphanIds.join(", ")}`);
}

const scenesPlan = slidesPayload.scenes || [];

// 幕太短（气口、引导句）会一闪而过，直接并进相邻幕
const timelineById = new Map(timeline.items.map((item) => [item.id, item]));
const spanOf = (scene) => {
  const list = scene.lineIds.map((id) => timelineById.get(id)).filter(Boolean);
  return list.length ? list[list.length - 1].end - list[0].start : 0;
};
for (let i = scenesPlan.length - 1; i >= 0; i -= 1) {
  if (scenesPlan.length <= 1) break;
  if (spanOf(scenesPlan[i]) >= 0.8) continue;
  const drop = scenesPlan[i];
  const target = scenesPlan[i + 1] || scenesPlan[i - 1];
  target.lineIds = i + 1 < scenesPlan.length ? [...drop.lineIds, ...target.lineIds] : [...target.lineIds, ...drop.lineIds];
  console.log(`[03] ${drop.id} 仅 ${spanOf(drop).toFixed(2)}s，并入 ${target.id}`);
  scenesPlan.splice(i, 1);
}

scenesPlan.forEach((scene, i) => {
  scene.total = scenesPlan.length;
  scene.kicker = `${String(i + 1).padStart(2, "0")} / ${String(scenesPlan.length).padStart(2, "0")}`;
});

const motionConfig = readMotion();

const scenes = scenesPlan.map((scene, sceneIndex) => {
  const items = scene.lineIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`时间轴缺少句子 ${id}`);
    return item;
  });

  const start = items[0].start;
  const end = items[items.length - 1].end;
  const frame = Math.round(end * video.fps);
  const durationInFrames = Math.max(1, frame - sceneCursor);
  sceneCursor = frame;

  const cues = items.map((item) => ({
    id: item.id,
    text: item.speech,
    at: Number((item.start - start).toFixed(3)),
    end: Number((item.end - start).toFixed(3)),
  }));

  const photo = resolvePhoto(scene.photoKey);

  return {
    ...scene,
    motion: resolveMotionForScene(motionConfig, sceneIndex),
    photo,
    photoAspect: photoAspectOf(photo),
    photoFocus: scene.layout === "hero" ? "center 42%" : "center 38%",
    audioStart: start,
    audioEnd: end,
    durationInFrames,
    cues,
  };
});

if (scenes.length && sceneCursor !== prevFrame) {
  console.warn(`[03] 幕总帧 ${sceneCursor} 与页总帧 ${prevFrame} 不一致，以幕为准`);
}

const sceneLayoutFile = path.join(paths.root, "pipeline", "scene-layouts.json");
if (fs.existsSync(sceneLayoutFile)) {
  try {
    const savedLayouts = JSON.parse(fs.readFileSync(sceneLayoutFile, "utf8").replace(/^\uFEFF/, ""));
    if (savedLayouts?.scriptHash === scriptHash && savedLayouts.layouts && typeof savedLayouts.layouts === "object") {
      let applied = 0;
      for (const scene of scenes) {
        const chapter = String(scene.chapter || "").trim();
        const key = chapter && chapter !== "未分章" ? `chapter:${chapter}` : `scene:${scene.id || ""}`;
        const layout = savedLayouts.layouts[key];
        scene.layoutStyle = layout || null;
        if (layout) applied += 1;
      }
      if (applied) console.log(`[03] 应用自定义画面布局：${applied} 幕`);
    }
  } catch (err) {
    console.warn(`[03] 读取画面布局失败：${err?.message || err}`);
  }
}

// ---------- 头像 / 数字人素材 ----------

const avatarDir = path.join(paths.root, "assets", "avatar");
const avatarOut = path.join(paths.remotion, "public", "avatar");
const avatarExts = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"];

function resolveAvatarSrc(src) {
  if (!src) return null;
  if (path.isAbsolute(src) && fs.existsSync(src)) return src;
  const direct = path.join(paths.root, src);
  if (fs.existsSync(direct)) return direct;
  const base = path.basename(src);
  for (const dir of [avatarDir, path.join(paths.output)]) {
    const candidate = path.join(dir, base);
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of avatarExts) {
    const candidate = path.join(avatarDir, `${base}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readDigitalHuman() {
  const file = path.join(paths.output, "digital-human.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    const video = data?.video && fs.existsSync(data.video) ? data.video : path.join(paths.output, "avatar.mp4");
    if (!fs.existsSync(video)) return null;
    return { ...data, video };
  } catch {
    return null;
  }
}

function prepareLayout() {
  const layout = readLayout();
  const digital = readDigitalHuman();
  if (digital) layout.mode = "video";
  if (layout.mode === "none") {
    console.log("[03] 布局：纯文案");
    return layout;
  }
  const legacyFile = path.join(paths.output, "avatar.mp4");
  const found = layout.mode === "video"
    ? digital?.video || resolveAvatarSrc(layout.avatar.src) || (fs.existsSync(legacyFile) ? legacyFile : null)
    : resolveAvatarSrc(layout.avatar.src);
  if (!found) {
    console.log(`[03] 布局：${layout.mode === "video" ? "动画+数字人" : "动画+静态头像"} · 未找到素材，降级纯文案`);
    return { ...layout, mode: "none" };
  }
  fs.mkdirSync(avatarOut, { recursive: true });
  const name = path.basename(found);
  fs.copyFileSync(found, path.join(avatarOut, name));
  const label = digital ? "动画+数字人（Kaggle 生成）" : layout.mode === "video" ? "动画+数字人" : "动画+静态头像";
  const aspect = Number(digital?.aspect) > 0 ? Number(digital.aspect) : layout.avatar.aspect;
  console.log(
    `[03] 布局：${label} · ${name} · 占比 ${Math.round(layout.avatar.width * 100)}% ` +
      `· 位置 (${Math.round(layout.avatar.x * 100)}, ${Math.round(layout.avatar.y * 100)}) ` +
      `· 避让${layout.avoid ? "开" : "关"}`,
  );
  return { ...layout, avatar: { ...layout.avatar, aspect, src: `avatar/${name}` } };
}

const layoutProps = prepareLayout();

function subtitlePlacement() {
  const base = { alignment: 2, marginL: 80, marginR: 80, marginV: 240, maxChars: 15, fontSize: 54 };
  if (layoutProps.mode === "none" || !layoutProps.avoid) return base;
  const a = layoutProps.avatar;
  const gap = Math.max(0, Number(layoutProps.gap) || 0);
  const width = Math.min(video.width, Math.max(120, a.width * video.width));
  const height = width / shapeRatio(a.shape, a.aspect);
  const cx = Math.min(video.width, Math.max(0, a.x * video.width));
  const cy = Math.min(video.height, Math.max(0, a.y * video.height));
  const left = cx - width / 2;
  const right = cx + width / 2;
  const top = Math.max(0, cy - height / 2);
  const bottom = Math.min(video.height, cy + height / 2);
  const centered = Math.abs(a.x - 0.5) < 0.09;
  if (centered) {
    return {
      ...base,
      marginV: Math.round(Math.max(240, Math.min(video.height * 0.62, video.height - top + gap))),
    };
  }
  const pad = 40;
  const edge = a.x > 0.5 ? left : video.width - right;
  const avail = Math.max(320, edge - pad * 2);
  return {
    alignment: 5,
    marginL: 0,
    marginR: 0,
    marginV: 0,
    maxChars: Math.max(10, Math.min(15, Math.floor(avail / 41))),
    fontSize: 42,
    pos: { x: Math.round(edge / 2) + 9, y: Math.round(cy) },
  };
}

const subtitle = subtitlePlacement();

const props = {
  meta: {
    ...slidesPayload.meta,
    totalSeconds: timeline.total,
    provider: timeline.provider,
    credits: usedCredits,
    scriptHash,
  },
  layout: layoutProps,
  style: { id: ui.styleId || "amber", motion: ui.motion || "standard" },
  slides: timed,
  scenes,
};
fs.writeFileSync(files.slidesTimed, JSON.stringify(props, null, 2), "utf8");

function assTime(sec) {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

function wrap(text, max = 15) {
  if (text.length <= max) return text;
  const chunks = [];
  let current = "";
  for (const ch of text) {
    if (!current && chunks.length && /[，,、；;：:。！？!?]/.test(ch)) {
      chunks[chunks.length - 1] += ch;
      continue;
    }
    if (/[，,、；;：:。！？!?]/.test(ch) && current.length >= max - 4) {
      current += ch;
      chunks.push(current);
      current = "";
      if (chunks.length === 1) continue;
    } else {
      current += ch;
      if (current.length >= max) {
        chunks.push(current);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.join("\\N");
}

const assLines = [
  "[Script Info]",
  "ScriptType: v4.00+",
  `PlayResX: ${video.width}`,
  `PlayResY: ${video.height}`,
  "WrapStyle: 0",
  "ScaledBorderAndShadow: yes",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  `Style: Default,Microsoft YaHei,${subtitle.fontSize},&H00F5F1EA,&H00F5F1EA,&H00101216,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,${subtitle.alignment},${subtitle.marginL},${subtitle.marginR},${subtitle.marginV},1`,
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];

const srtBlocks = [];

const PUNCT = /[，,、；;：:。！？!?]/;

function captionClauses(text) {
  const clean = text.replace(/[。；;]+$/g, "").replace(/\s+/g, "");
  return (clean.match(/[^，,、；;：:。！？!?]*[，,、；;：:。！？!?]?/g) || [])
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitCaption(text) {
  const soft = 14;
  const hard = 16;
  const chunks = [];
  let current = "";
  for (let clause of captionClauses(text)) {
    while (clause.length > hard) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const parts = Math.ceil(clause.length / soft);
      const target = Math.ceil(clause.length / parts);
      let cut = target;
      for (let k = target; k <= Math.min(clause.length - 2, target + 4); k += 1) {
        if (PUNCT.test(clause[k - 1])) {
          cut = k;
          break;
        }
      }
      chunks.push(clause.slice(0, cut));
      clause = clause.slice(cut);
    }
    if (!current) current = clause;
    else if (current.length + clause.length <= soft) current += clause;
    else {
      chunks.push(current);
      current = clause;
    }
  }
  if (current) chunks.push(current);
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 5) {
    const last = chunks.pop();
    const prev = chunks.pop();
    const merged = prev + last;
    if (merged.length <= hard) {
      const mid = Math.ceil(merged.length / 2);
      let cut = mid;
      for (let k = mid; k <= Math.min(merged.length - 2, mid + 3); k += 1) {
        if (PUNCT.test(merged[k - 1])) {
          cut = k;
          break;
        }
      }
      chunks.push(merged.slice(0, cut), merged.slice(cut));
    } else {
      chunks.push(prev, last);
    }
  }
  for (let i = 0; i < chunks.length; i += 1) {
    if (i > 0 && /^[”’」』）]/.test(chunks[i])) {
      chunks[i - 1] += chunks[i][0];
      chunks[i] = chunks[i].slice(1);
    }
    if (i < chunks.length - 1 && /[“‘「『（]$/.test(chunks[i])) {
      chunks[i + 1] = chunks[i].slice(-1) + chunks[i + 1];
      chunks[i] = chunks[i].slice(0, -1);
    }
  }
  return chunks.filter(Boolean);
}

function cueWeight(text) {
  return [...text].reduce((w, ch) => w + (PUNCT.test(ch) ? 2.2 : 1), 0);
}

function captionsFor(item) {
  const parts = splitCaption(item.speech);
  const total = Math.max(0.01, item.end - item.start);
  const min = Math.min(1.15, total / Math.max(1, parts.length));
  const weights = parts.map(cueWeight);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const extra = Math.max(0, total - min * parts.length);
  let cursor = item.start;
  return parts.map((text, i) => {
    const span = min + extra * (weights[i] / weightSum);
    const end = i === parts.length - 1 ? item.end : Math.min(item.end, cursor + span);
    const cue = { start: cursor, end, text };
    cursor = end;
    return cue;
  });
}

const captionCues = timeline.items.flatMap((item) => captionsFor(item));

for (let i = 1; i < captionCues.length; i += 1) {
  const leading = captionCues[i].text.match(/^([”’」』）]+)(.+)$/);
  if (leading) {
    captionCues[i - 1].text += leading[1];
    captionCues[i].text = leading[2];
  }
}

captionCues.forEach((cue, i) => {
  const text = wrap(cue.text, 16);
  const posTag = subtitle.pos ? `{\\an5\\pos(${subtitle.pos.x},${subtitle.pos.y})}` : "";
  assLines.push(
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${posTag}${text}`,
  );
  srtBlocks.push(
    `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`,
  );
});

fs.writeFileSync(files.subtitlesAss, assLines.join("\n"), "utf8");
fs.writeFileSync(files.subtitlesSrt, srtBlocks.join("\n"), "utf8");

console.log(`[03] 时间轴：${timeline.items.length} 句 / ${scenes.length} 幕，fps ${video.fps}，总 ${prevFrame} 帧（${timeline.total}s）`);
if (timeline.provider) console.log(`[03] 语音来源：${timeline.provider}`);
for (const sc of scenes) {
  const photoInfo = sc.photo
    ? `图 ${sc.photoKey} -> ${sc.photo}`
    : sc.photoKey === "topic"
      ? "无指定配图（纹理版）"
      : `图 ${sc.photoKey || "无"}（缺失，降级纹理版）`;
  console.log(
    `[03] ${sc.id} ${sc.audioStart.toFixed(2)}–${sc.audioEnd.toFixed(2)}s ` +
      `(${sc.durationInFrames} 帧) [${sc.layout}] ${sc.lines.length} 句 / ${sc.cues.length} cue · ${photoInfo}`,
  );
}
if (missingPhotos.size) {
  console.log(`[03] 缺失配图 ${missingPhotos.size} 个：${[...missingPhotos].join(", ")}`);
  console.log("[03] 稍后重跑 03 会自动重试；也可用 scripts/fetch_photos.py --auto 手动补齐");
}
console.log(`[03] 字幕：subtitles.ass / subtitles.srt（${captionCues.length} 条）`);
console.log(`字幕：${path.basename(files.subtitlesAss)} / ${path.basename(files.subtitlesSrt)}`);
