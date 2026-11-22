import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { privatePaths, readPrivate, writePrivate } from "./pipeline/private.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const yes = process.argv.includes("--yes") || process.argv.includes("-y");

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
    path.join(ROOT, ".venv", "Scripts", "python.exe"),
    where("python"),
  ].find((value) => value && fs.existsSync(value));
  const chrome = [
    local.chrome,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].find((value) => value && fs.existsSync(value));
  return {
    python: python || "",
    ffmpeg: local.ffmpeg || where("ffmpeg") || "ffmpeg",
    ffprobe: local.ffprobe || where("ffprobe") || "ffprobe",
    chrome: chrome || "",
    modelsRoot: fs.existsSync(local.modelsRoot) ? local.modelsRoot : path.join(ROOT, "models"),
    vendorRoot: fs.existsSync(local.vendorRoot) ? local.vendorRoot : path.join(ROOT, "vendor"),
    voiceStudioRoot: fs.existsSync(local.voiceStudioRoot) ? local.voiceStudioRoot : path.join(ROOT, "vendor", "VoiceStudio"),
    kagglePython: fs.existsSync(local.kagglePython) ? local.kagglePython : path.join(ROOT, "pipeline", "tts", ".venv-kaggle", "Scripts", "python.exe"),
    kaggleBin: fs.existsSync(local.kaggleBin) ? local.kaggleBin : path.join(ROOT, "pipeline", "tts", ".venv-kaggle", "Scripts", "kaggle.exe"),
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
    voicestudio: { apiBase: "http://127.0.0.1:3900", refWav: "assets/voice-ref/0226_prompt.wav" },
    cosyvoice: { refWav: "assets/voice-ref/0226_prompt.wav" },
    local3: { refWav: "assets/voice-ref/0226_prompt.wav" },
    indextts: { promptWav: "assets/voice-ref/0226_prompt.wav" },
    kaggle: { promptWav: "assets/voice-ref/0226_prompt.wav" },
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
