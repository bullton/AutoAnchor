import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findChrome, privatePaths, readPrivate, venvPython, writePrivate } from "./pipeline/private.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const yes = process.argv.includes("--yes") || process.argv.includes("-y");
const AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a", ".flac"]);
const PROVIDERS = ["voicestudio", "local3", "cosyvoice", "indextts", "kaggle", "edge"];

const toPublicPath = (file) => {
  const rel = path.relative(ROOT, file);
  return rel.startsWith("..") ? file.replaceAll("\\", "/") : rel.replaceAll("\\", "/");
};

const findSample = (value, voiceDir) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return [path.resolve(ROOT, text), path.resolve(voiceDir, text)].find((file) => fs.existsSync(file) && AUDIO_EXTS.has(path.extname(file).toLowerCase())) || "";
};

const firstVoice = (voiceDir) => {
  try {
    return fs.readdirSync(voiceDir)
      .filter((name) => AUDIO_EXTS.has(path.extname(name).toLowerCase()) && !name.startsWith("_upload-"))
      .sort()[0] || "";
  } catch {
    return "";
  }
};

function where(bin) {
  try {
    return execFileSync(process.platform === "win32" ? "where.exe" : "which", [bin], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    })
      .split(/\r?\n/)[0]
      .trim();
  } catch {
    return "";
  }
}

const exists = (file) => {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
};

const hasAll = (dir, names) => names.every((name) => exists(path.join(dir, name)));

function detect() {
  const local = privatePaths(readPrivate());
  const python = [
    local.python,
    process.env.OD_PYTHON,
    venvPython(path.join(ROOT, ".venv")),
    where("python"),
  ].find((value) => value && fs.existsSync(value));
  const chrome = findChrome(local.chrome);
  return {
    python: python || "",
    ffmpeg: local.ffmpeg && fs.existsSync(local.ffmpeg) ? local.ffmpeg : where("ffmpeg"),
    ffprobe: local.ffprobe && fs.existsSync(local.ffprobe) ? local.ffprobe : where("ffprobe"),
    chrome: chrome || "",
    modelsRoot: fs.existsSync(local.modelsRoot) ? local.modelsRoot : path.join(ROOT, "models"),
    vendorRoot: fs.existsSync(local.vendorRoot) ? local.vendorRoot : path.join(ROOT, "vendor"),
    voiceStudioRoot: fs.existsSync(local.voiceStudioRoot) ? local.voiceStudioRoot : path.join(ROOT, "vendor", "VoiceStudio"),
    indexttsRepo: fs.existsSync(local.indexttsRepo) ? local.indexttsRepo : "",
    kagglePython: fs.existsSync(local.kagglePython) ? local.kagglePython : venvPython(path.join(ROOT, "pipeline", "tts", ".venv-kaggle")),
    kaggleBin: fs.existsSync(local.kaggleBin) ? local.kaggleBin : venvPython(path.join(ROOT, "pipeline", "tts", ".venv-kaggle"), "kaggle"),
    voiceRef: local.voiceRef || path.join(ROOT, "assets", "voice-ref"),
  };
}

function kaggleToken() {
  const priv = readPrivate();
  if (String(priv.kaggle?.username || "").trim() && String(priv.kaggle?.key || priv.kaggle?.token || "").trim()) return true;
  const dirs = [path.join(os.homedir(), ".kaggle"), process.env.KAGGLE_CONFIG_DIR || ""].filter(Boolean);
  return dirs.some((dir) => ["access_token", "kaggle.json"].some((name) => exists(path.join(dir, name))));
}

function detectProviders(found) {
  const priv = readPrivate();
  const tts = priv.tts || {};
  const local = privatePaths(priv);
  const edgeModule = (() => {
    const py = found.python;
    if (!py) return false;
    const r = spawnSync(py, ["-c", "import edge_tts"], { encoding: "utf8", timeout: 8000, windowsHide: true });
    return r.status === 0;
  })();
  const vsRoot = path.resolve(tts.voicestudio?.root || found.voiceStudioRoot);
  const local3Dir = path.resolve(tts.local3?.modelPath || local.cosyvoice3Model || path.join(found.modelsRoot, "Fun-CosyVoice3-0.5B"));
  const cosyDir = path.resolve(tts.cosyvoice?.modelPath || local.cosyvoiceModel || path.join(found.modelsRoot, "CosyVoice2-0.5B"));
  const indeRoot = path.resolve(tts.indextts?.repoPath || found.indexttsRepo || local.indexttsRepo || "");
  const indeModel = path.resolve(tts.indextts?.modelDir || local.indexttsModel || path.join(indeRoot, "checkpoints"));
  return {
    voicestudio: {
      ok: exists(path.join(vsRoot, "server.env.json")),
      reason: exists(path.join(vsRoot, "server.env.json")) ? "" : `未找到 ${path.join(vsRoot, "server.env.json")}`,
    },
    local3: {
      ok: hasAll(local3Dir, ["llm.pt", "flow.pt", "hift.pt", "speech_tokenizer_v2.onnx"]),
      reason: `CosyVoice3 权重不完整（${local3Dir}）`,
    },
    cosyvoice: {
      ok: hasAll(cosyDir, ["llm.pt", "flow.pt", "hift.pt", "speech_tokenizer_v2.onnx"]),
      reason: `CosyVoice2 权重不完整（${cosyDir}）`,
    },
    indextts: {
      ok: Boolean(indeRoot) && exists(path.join(indeModel, "config.yaml")),
      reason: `IndexTTS 未安装或缺少 ${path.join(indeModel, "config.yaml")}`,
    },
    kaggle: {
      ok: kaggleToken() && exists(found.kaggleBin),
      reason: !kaggleToken() ? "缺少 Kaggle 凭据（~/.kaggle/access_token）" : `缺少 Kaggle CLI（${found.kaggleBin}）`,
    },
    edge: {
      ok: edgeModule,
      reason: "未安装 edge-tts（python -m pip install edge-tts）",
    },
  };
}

function preflightSummary() {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "preflight.mjs"), "--json", "--no-prompt"], {
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
  if (r.status !== 0 || !r.stdout) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

const found = detect();
const providers = detectProviders(found);
const preflight = preflightSummary();

console.log("\n口播工坊 · 首次配置\n");
console.log("只填写本机私有参数；模型与密钥不会写入项目仓库。\n");

if (preflight?.hardware) {
  const hw = preflight.hardware;
  console.log(`本机：${hw.cpu} · ${hw.cores} 核 · 内存 ${hw.ramGB}GB · 可用磁盘 ${hw.freeDiskGB}GB`);
  console.log(`显卡：${hw.gpu?.name || "未检测"}`);
  const ready = PROVIDERS.filter((key) => providers[key]?.ok);
  console.log(`可用配音方案：${ready.length ? ready.join(" / ") : "无（将使用 Edge-TTS）"}`);
  if (!preflight.remotion?.ok) console.log(`提示：${preflight.remotion?.fix || "Remotion 依赖未安装"}`);
  if (preflight.recommendation?.length) console.log(`建议本地模型：${preflight.recommendation.join(" / ")}`);
  console.log("");
}

const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
const ask = async (label, fallback, hint = "") => {
  if (yes) return fallback;
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${label}${suffix}${hint ? `（${hint}）` : ""}: `)).trim();
  return answer || fallback;
};

const askPath = async (label, detected, hint = "") => {
  if (detected) {
    console.log(`✓ ${label}：${detected}`);
    return detected;
  }
  return ask(label, "", hint);
};

console.log("── 环境路径（自动探测到的直接使用，不再追问）──");
const paths = {
  python: await askPath("Python 路径", found.python, "配音阶段使用"),
  ffmpeg: await askPath("FFmpeg", found.ffmpeg, "需要带 libass / subtitles 滤镜"),
  ffprobe: await askPath("FFprobe", found.ffprobe),
  chrome: await askPath("Chrome（可选）", found.chrome),
  modelsRoot: await askPath("模型根目录", found.modelsRoot),
  vendorRoot: await askPath("依赖根目录", found.vendorRoot),
  voiceStudioRoot: await askPath("VoiceStudio 目录", found.voiceStudioRoot),
  indexttsRepo: await askPath("IndexTTS 目录（可留空）", found.indexttsRepo),
  kagglePython: await askPath("Kaggle Python", found.kagglePython, "数字人阶段"),
  kaggleBin: await askPath("Kaggle CLI", found.kaggleBin),
  voiceRef: await askPath("参考音色目录", found.voiceRef),
};

const preferred = readPrivate().tts?.provider;
const providerDefault = PROVIDERS.find((key) => key === preferred && providers[key]?.ok)
  || PROVIDERS.find((key) => providers[key]?.ok)
  || "edge";
let provider = await ask("默认配音方案", providerDefault, PROVIDERS.join(" / "));
if (!PROVIDERS.includes(provider)) provider = providerDefault;

if (!providers[provider]?.ok) {
  const why = providers[provider]?.reason || "未检测到可用组件";
  console.log(`\n注意：${provider} 当前不可用：${why}`);
  if (yes) {
    console.log("--yes 模式不会静默写入不可用方案，已改用 edge。\n");
    provider = "edge";
  } else {
    const pick = await ask("改用哪个可用方案", providers.edge.ok ? "edge" : providerDefault, "必须选一个已安装的方案");
    provider = PROVIDERS.includes(pick) && providers[pick]?.ok ? pick : providers.edge.ok ? "edge" : providerDefault;
  }
}

const voiceDir = path.isAbsolute(paths.voiceRef) ? paths.voiceRef : path.join(ROOT, paths.voiceRef);
let refWav = "";
let refText = "";
if (provider !== "edge") {
  const sampleInput = await ask("样本声音（wav/mp3/m4a/flac）", firstVoice(voiceDir), "必须是自己的 3-10 秒干净人声；留空则退回 edge");
  const sample = findSample(sampleInput, voiceDir);
  if (!sample) {
    console.log(`\n没有样本音色，${provider} 无法克隆。已退回 edge（可在控制台上传音色后再切回）。\n`);
    provider = "edge";
  } else {
    fs.mkdirSync(voiceDir, { recursive: true });
    const ext = path.extname(sample).toLowerCase();
    const target = path.join(voiceDir, ext === ".wav" ? path.basename(sample) : `${path.basename(sample, ext)}.wav`);
    if (path.resolve(sample) !== path.resolve(target)) {
      if (ext === ".wav") {
        fs.copyFileSync(sample, target);
      } else {
        try {
          execFileSync(found.ffmpeg, ["-y", "-v", "error", "-i", sample, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", target], {
            timeout: 120000,
            windowsHide: true,
          });
        } catch (err) {
          console.log(`\n无法转换样本声音：${err?.message || err}\n请先确认 FFmpeg 可用，或直接提供 wav 文件。\n`);
        }
      }
    }
    if (fs.existsSync(target)) {
      refWav = toPublicPath(target);
      let fallbackText = "";
      try {
        fallbackText = fs.readFileSync(target.replace(/\.wav$/i, ".txt"), "utf8").trim();
      } catch {}
      refText = await ask("样本朗读文本（可留空）", fallbackText, "填写录音里说的原话；留空会影响克隆稳定性");
      if (refText) fs.writeFileSync(target.replace(/\.wav$/i, ".txt"), `${refText}\n`, "utf8");
    }
  }
}

console.log("\n── 外部服务（可跳过）──");
const kaggleUser = await ask("Kaggle 用户名（数字人，可留空）", "");
const kaggleKey = kaggleUser ? await ask("Kaggle API Key / Token（可留空）", "") : "";
const kaggleKernel = await ask("Kaggle Notebook", "latentsync-dual");
const kaggleAccel = await ask("Kaggle 加速器", "NvidiaTeslaT4", "NvidiaTeslaT4 = T4 x2");
console.log("\n── AI 分镜（可跳过）──");
const aiEnabled = String(await ask("启用 AI 分镜？(y/N)", "n")).toLowerCase().startsWith("y");
let ai = {
  enabled: aiEnabled,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  keyEnv: "OPENAI_API_KEY",
  apiKey: "",
  temperature: 0.55,
  maxTokens: 2400,
  extraPrompt: "",
};
if (aiEnabled) {
  ai.baseUrl = await ask("AI 接口地址", ai.baseUrl);
  ai.model = await ask("AI 模型", ai.model);
  ai.apiKey = await ask("API Key（可留空，改用环境变量）", "");
  ai.keyEnv = await ask("Key 环境变量名", "OPENAI_API_KEY");
}

if (rl) rl.close();

writePrivate({
  version: 1,
  setupCompleted: true,
  source: "setup-cli",
  paths,
  tts: {
    provider,
    ...(refWav ? {
      voicestudio: { apiBase: "http://127.0.0.1:3900", refWav, refText },
      cosyvoice: { refWav, refText },
      local3: { refWav, refText },
      indextts: { promptWav: refWav },
      kaggle: { promptWav: refWav },
    } : {}),
  },
  kaggle: {
    username: kaggleUser,
    key: kaggleKey,
    token: "",
    cli: "",
    dataset: "",
    kernel: kaggleKernel || "latentsync-dual",
    accelerator: kaggleAccel || "NvidiaTeslaT4",
    timeoutMin: 120,
  },
  ai,
});

console.log(`\n配置已写入 config/private.json（配音方案：${provider}${refWav ? "，样本音色：" + refWav : ""}）。`);
console.log("下一步：npm run doctor 复核，然后 npm start。\n");
