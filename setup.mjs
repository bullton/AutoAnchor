import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findChrome, privatePaths, readPrivate, venvPython, writePrivate } from "./pipeline/private.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const yes = process.argv.includes("--yes") || process.argv.includes("-y");
const AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a", ".flac"]);

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
    ffmpeg: local.ffmpeg || where("ffmpeg") || "ffmpeg",
    ffprobe: local.ffprobe || where("ffprobe") || "ffprobe",
    chrome: chrome || "",
    modelsRoot: fs.existsSync(local.modelsRoot) ? local.modelsRoot : path.join(ROOT, "models"),
    vendorRoot: fs.existsSync(local.vendorRoot) ? local.vendorRoot : path.join(ROOT, "vendor"),
    voiceStudioRoot: fs.existsSync(local.voiceStudioRoot) ? local.voiceStudioRoot : path.join(ROOT, "vendor", "VoiceStudio"),
    kagglePython: fs.existsSync(local.kagglePython) ? local.kagglePython : venvPython(path.join(ROOT, "pipeline", "tts", ".venv-kaggle")),
    kaggleBin: fs.existsSync(local.kaggleBin) ? local.kaggleBin : venvPython(path.join(ROOT, "pipeline", "tts", ".venv-kaggle"), "kaggle"),
    voiceRef: local.voiceRef || path.join(ROOT, "assets", "voice-ref"),
  };
}

const found = detect();
console.log("\n口播工坊 · 首次配置\n");
console.log("只填写本机私有参数；模型与密钥不会写入项目仓库。\n");

const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
const ask = async (label, fallback, hint = "") => {
  if (yes) return fallback;
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${label}${suffix}${hint ? `（${hint}）` : ""}: `)).trim();
  return answer || fallback;
};

const paths = {
  python: await ask("Python 路径", found.python, "配音阶段使用"),
  ffmpeg: await ask("FFmpeg", found.ffmpeg),
  ffprobe: await ask("FFprobe", found.ffprobe),
  chrome: await ask("Chrome（可选）", found.chrome),
  modelsRoot: await ask("模型根目录", found.modelsRoot),
  vendorRoot: await ask("依赖根目录", found.vendorRoot),
  voiceStudioRoot: await ask("VoiceStudio 目录", found.voiceStudioRoot),
  indexttsRepo: await ask("IndexTTS 目录（可留空）", ""),
  kagglePython: await ask("Kaggle Python", found.kagglePython, "数字人阶段"),
  kaggleBin: await ask("Kaggle CLI", found.kaggleBin),
  voiceRef: await ask("参考音色目录", found.voiceRef),
};
const provider = await ask("默认配音方案", "voicestudio", "voicestudio / local3 / indextts / kaggle / edge");

const voiceDir = path.isAbsolute(paths.voiceRef) ? paths.voiceRef : path.join(ROOT, paths.voiceRef);
let refWav = "";
let refText = "";
if (provider !== "edge") {
  const sampleInput = await ask("样本声音（wav/mp3/m4a/flac，可留空）", firstVoice(voiceDir), "必须是自己的 3-10 秒干净人声");
  const sample = findSample(sampleInput, voiceDir);
  if (!sample) {
    console.log("\n提示：没有找到样本声音。请把自己的录音放到参考音色目录，或在首次配置页上传。\n");
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
      refText = await ask("样本朗读文本（可留空）", fallbackText, "填写录音里说的原话，克隆会更稳");
      if (refText) fs.writeFileSync(target.replace(/\.wav$/i, ".txt"), `${refText}\n`, "utf8");
    }
  }
}

const kaggleUser = await ask("Kaggle 用户名（数字人，可留空）", "");
const kaggleKey = kaggleUser ? await ask("Kaggle API Key / Token（可留空）", "") : "";
const kaggleKernel = await ask("Kaggle Notebook", "latentsync-dual");
const kaggleAccel = await ask("Kaggle 加速器", "NvidiaTeslaT4", "NvidiaTeslaT4 = T4 x2");
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

console.log("\n配置已写入 config/private.json。");
console.log("下一步：npm run doctor，然后 npm start。\n");
