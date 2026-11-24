import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(HERE, "..");
export const PRIVATE_FILE = process.env.OD_PRIVATE_CONFIG
  ? path.resolve(process.env.OD_PRIVATE_CONFIG)
  : path.join(ROOT, "config", "private.json");
export const PRIVATE_EXAMPLE = path.join(ROOT, "config", "private.example.json");

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function deepMerge(base, patch) {
  const out = isObject(base) ? { ...base } : {};
  if (!isObject(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

const EMPTY = {
  version: 1,
  setupCompleted: false,
  source: "manual",
  paths: {
    python: "",
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
    chrome: "",
    modelsRoot: "",
    vendorRoot: "",
    cosyvoiceVendor: "",
    cosyvoiceModel: "",
    voiceStudioRoot: "",
    indexttsRepo: "",
    indexttsPython: "",
    indexttsModel: "",
    kagglePython: "",
    kaggleBin: "",
    voiceRef: "",
  },
  tts: {},
  kaggle: {
    username: "",
    key: "",
    token: "",
    cli: "",
    dataset: "",
    kernel: "latentsync-dual",
    accelerator: "NvidiaTeslaT4",
    timeoutMin: 120,
    queueTimeoutMin: 3,
    queueRetries: 3,
  },
  ai: {
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyEnv: "OPENAI_API_KEY",
    apiKey: "",
    temperature: 0.4,
    maxTokens: 2400,
    extraPrompt: "",
  },
};

export function readPrivate() {
  try {
    const raw = JSON.parse(fs.readFileSync(PRIVATE_FILE, "utf8").replace(/^\uFEFF/, ""));
    return deepMerge(EMPTY, raw);
  } catch {
    return { ...EMPTY, paths: { ...EMPTY.paths }, ai: { ...EMPTY.ai } };
  }
}

export function writePrivate(patch = {}) {
  const merged = deepMerge(readPrivate(), patch);
  fs.mkdirSync(path.dirname(PRIVATE_FILE), { recursive: true });
  fs.writeFileSync(PRIVATE_FILE, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export function resolvePath(value, base = ROOT) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (path.isAbsolute(text)) return path.normalize(text);
  return path.resolve(base, text);
}

export const IS_WIN = process.platform === "win32";

export function venvPython(venvDir, name = "python") {
  return path.join(venvDir, IS_WIN ? "Scripts" : "bin", IS_WIN ? `${name}.exe` : name);
}

export function chromeCandidates(configured = "") {
  const list = [configured, process.env.OD_CHROME || "", process.env.CHROME_PATH || ""];
  if (IS_WIN) {
    const drive = process.env.SystemDrive || process.env.HOMEDRIVE || "C:";
    for (const base of [
      process.env.ProgramFiles,
      process.env.ProgramW6432,
      process.env["ProgramFiles(x86)"],
      path.join(drive, "Program Files"),
      path.join(drive, "Program Files (x86)"),
      process.env.LOCALAPPDATA,
    ]) {
      if (base) list.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    list.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return [...new Set(list.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function findChrome(configured = "") {
  for (const file of chromeCandidates(configured)) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return "";
}

export function privatePaths(priv = readPrivate()) {
  const p = priv.paths || {};
  return {
    ...p,
    python: resolvePath(p.python || venvPython(".venv")),
    ffmpeg: String(p.ffmpeg || "ffmpeg"),
    ffprobe: String(p.ffprobe || "ffprobe"),
    chrome: resolvePath(p.chrome || ""),
    modelsRoot: resolvePath(p.modelsRoot || "models"),
    vendorRoot: resolvePath(p.vendorRoot || "vendor"),
    cosyvoiceVendor: resolvePath(p.cosyvoiceVendor || path.join(p.vendorRoot || "vendor", "CosyVoice")),
    cosyvoiceModel: resolvePath(p.cosyvoiceModel || path.join(p.modelsRoot || "models", "CosyVoice2-0.5B")),
    voiceStudioRoot: resolvePath(p.voiceStudioRoot || path.join(p.vendorRoot || "vendor", "VoiceStudio")),
    indexttsRepo: resolvePath(p.indexttsRepo || ""),
    indexttsPython: resolvePath(p.indexttsPython || ""),
    indexttsModel: resolvePath(p.indexttsModel || ""),
    kagglePython: resolvePath(p.kagglePython || venvPython(path.join("pipeline", "tts", ".venv-kaggle"))),
    kaggleBin: resolvePath(p.kaggleBin || venvPython(path.join("pipeline", "tts", ".venv-kaggle"), "kaggle")),
    kaggleConfigDir: resolvePath(p.kaggleConfigDir || path.join("config", ".kaggle")),
    voiceRef: resolvePath(p.voiceRef || path.join("assets", "voice-ref")),
  };
}

export function readTtsBase() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline", "tts", "config.json"), "utf8"));
  } catch {
    return {};
  }
}

export function mergeTtsConfig(base = readTtsBase(), priv = readPrivate()) {
  const overlay = isObject(priv.tts) ? priv.tts : {};
  return deepMerge(base, overlay);
}

export function privateAi() {
  try {
    const raw = JSON.parse(fs.readFileSync(PRIVATE_FILE, "utf8").replace(/^\uFEFF/, ""));
    if (!raw?.ai || typeof raw.ai !== "object" || !Object.keys(raw.ai).length) return null;
    return deepMerge(EMPTY.ai, raw.ai);
  } catch {
    return null;
  }
}

export function maskedPrivate() {
  const priv = readPrivate();
  const ai = { ...(priv.ai || {}) };
  const hasApiKey = Boolean(String(ai.apiKey || "").trim());
  if (ai.apiKey) ai.apiKey = "";
  ai.hasApiKey = hasApiKey;
  return { ...priv, ai };
}

export function setupState() {
  const exists = fs.existsSync(PRIVATE_FILE);
  const priv = readPrivate();
  const p = privatePaths(priv);
  const tts = mergeTtsConfig(readTtsBase(), priv);
  const provider = tts.provider || "voicestudio";
  const providerCfg = tts[provider] || {};
  const voiceValue = provider === "indextts" || provider === "kaggle" ? providerCfg.promptWav : providerCfg.refWav;
  const voiceFile = resolvePath(voiceValue);
  const builtinVoice = provider === "edge" || (provider === "cosyvoice" && String(providerCfg.mode || "").toLowerCase() === "sft");
  const voiceOk = builtinVoice || Boolean(voiceFile && fs.existsSync(voiceFile) && fs.statSync(voiceFile).size > 0);
  const checks = [
    { key: "private", label: "私有化配置", ok: exists, text: exists ? PRIVATE_FILE : "尚未创建" },
    { key: "python", label: "Python", ok: Boolean(p.python && fs.existsSync(p.python)), text: p.python || "未填写" },
    { key: "ffmpeg", label: "FFmpeg", ok: Boolean(p.ffmpeg), text: p.ffmpeg || "未填写" },
    { key: "voiceSample", label: "样本声音", ok: voiceOk, text: builtinVoice ? "使用引擎内置音色" : voiceOk ? path.basename(voiceFile) : "未上传（请使用自己的声音）" },
    { key: "remotion", label: "Remotion 依赖", ok: fs.existsSync(path.join(ROOT, "remotion", "node_modules", ".bin")), text: "remotion/node_modules" },
    { key: "assets", label: "素材目录", ok: fs.existsSync(path.join(ROOT, "assets")), text: "assets/" },
    { key: "ai", label: "AI 分镜", ok: Boolean(priv.ai?.enabled && (priv.ai?.apiKey || process.env[priv.ai?.keyEnv || ""])), text: priv.ai?.enabled ? `${priv.ai.model || "已配置"}` : "未启用（可跳过）" },
  ];
  return {
    completed: Boolean(exists && priv.setupCompleted !== false),
    exists,
    source: priv.source || "manual",
    privateFile: PRIVATE_FILE,
    paths: p,
    tts,
    kaggle: {
      ...(priv.kaggle || {}),
      key: "",
      token: "",
      hasKey: Boolean(String(priv.kaggle?.key || "").trim()),
      hasToken: Boolean(String(priv.kaggle?.token || "").trim()),
    },
    ai: { ...(priv.ai || {}), apiKey: "", hasApiKey: Boolean(priv.ai?.apiKey) },
    checks,
  };
}
