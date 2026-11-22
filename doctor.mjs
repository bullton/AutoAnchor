import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { privateAi, privatePaths, readPrivate, readTtsBase, mergeTtsConfig, PRIVATE_FILE } from "./pipeline/private.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const json = process.argv.includes("--json");

function exists(file) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 8000, windowsHide: true }).trim();
  } catch {
    return "";
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

const priv = readPrivate();
const local = privatePaths(priv);
const tts = mergeTtsConfig(readTtsBase(), priv);
const ai = privateAi();
const checks = [];
const add = (key, label, ok, text, required = false) => checks.push({ key, label, ok, text, required });

const nodeMajor = Number(process.versions.node.split(".")[0]);
add("node", "Node", nodeMajor >= 20, process.version, true);
add("private", "私有配置", fs.existsSync(PRIVATE_FILE), fs.existsSync(PRIVATE_FILE) ? "已创建" : "运行 npm run setup", true);
add("python", "Python", exists(local.python), exists(local.python) ? run(local.python, ["--version"]) || local.python : local.python, true);
add("ffmpeg", "FFmpeg", Boolean(run(local.ffmpeg, ["-version"])), run(local.ffmpeg, ["-version"]).split(/\r?\n/)[0] || local.ffmpeg, true);
add("ffprobe", "FFprobe", Boolean(run(local.ffprobe, ["-version"])), run(local.ffprobe, ["-version"]).split(/\r?\n/)[0] || local.ffprobe);
const filterList = run(local.ffmpeg, ["-hide_banner", "-filters"]);
const hasSubtitles = /\bsubtitles\b/.test(filterList) && /\bass\b/.test(filterList);
add(
  "ffmpeg-libass",
  "字幕滤镜",
  hasSubtitles,
  hasSubtitles ? "subtitles / ass 可用" : "缺少 subtitles 滤镜：换 ffmpeg-static（vendor/ffmpeg）或在 preflight 里检查",
  true,
);
add("remotion", "Remotion 依赖", fs.existsSync(path.join(ROOT, "remotion", "node_modules", ".bin")), "remotion/node_modules", true);
add("script", "文案目录", fs.existsSync(path.join(ROOT, "input")), "input/");
add("assets", "素材目录", fs.existsSync(path.join(ROOT, "assets")), "assets/");
const voiceProvider = tts.provider || "voicestudio";
const voiceCfg = tts[voiceProvider] || {};
const voiceValue = voiceProvider === "indextts" || voiceProvider === "kaggle" ? voiceCfg.promptWav : voiceCfg.refWav;
const voiceFile = voiceValue ? (path.isAbsolute(voiceValue) ? voiceValue : path.join(ROOT, voiceValue)) : "";
const builtinVoice = voiceProvider === "edge" || (voiceProvider === "cosyvoice" && String(voiceCfg.mode || "").toLowerCase() === "sft");
const voiceOk = builtinVoice || Boolean(voiceFile && exists(voiceFile));
const absVoice = (value) => (value ? (path.isAbsolute(value) ? value : path.join(ROOT, value)) : "");
const cloneVoice = ["voicestudio", "cosyvoice", "local3", "indextts", "kaggle"]
  .map((key) => absVoice(tts[key]?.refWav || tts[key]?.promptWav))
  .find((file) => file && exists(file));
const cloneConflict = builtinVoice && Boolean(cloneVoice);
add("voice", "样本声音", voiceOk, builtinVoice ? "使用引擎内置音色" : voiceOk ? voiceFile : "未上传（请在 npm run setup 中提供自己的声音）", !builtinVoice);
if (cloneConflict) {
  add(
    "voice-clone",
    "克隆音色",
    false,
    `已上传 ${cloneVoice}，但当前方案 ${voiceProvider} 不支持克隆，成片不会使用这个音色；请改用 local3 / voicestudio / indextts / kaggle`,
    false,
  );
} else if (cloneVoice) {
  add("voice-clone", "克隆音色", true, cloneVoice);
}
add("models", "模型目录", fs.existsSync(local.modelsRoot), local.modelsRoot);
add("vendor", "依赖目录", fs.existsSync(local.vendorRoot), local.vendorRoot);
add("voicestudio", "VoiceStudio", fs.existsSync(path.join(local.voiceStudioRoot, "server.env.json")), local.voiceStudioRoot);
add("provider", "配音方案", Boolean(tts.provider), tts.provider || "未设置");
const kaggle = priv.kaggle || {};
const kaggleDirs = [local.kaggleConfigDir, process.env.KAGGLE_CONFIG_DIR || "", path.join(os.homedir(), ".kaggle")].filter(Boolean);
const kaggleCred = Boolean(String(kaggle.username || "").trim() && String(kaggle.key || kaggle.token || "").trim())
  || kaggleDirs.some((dir) => ["kaggle.json", "access_token"].some((name) => fs.existsSync(path.join(dir, name))));
add("kaggle-cli", "Kaggle CLI", exists(local.kaggleBin), local.kaggleBin);
add("kaggle-auth", "Kaggle 凭据", kaggleCred, kaggleCred ? kaggle.username || "已配置" : "未配置（数字人可选）");
add("ai", "AI 分镜", Boolean(ai?.enabled && (ai.apiKey || process.env[ai.keyEnv || ""])), ai?.enabled ? ai.model : "未启用（可选）");

const free = await portFree(Number(process.env.OD_UI_PORT || 4310));
add("port", "控制台端口", free, free ? "4310 可用" : "4310 已被占用（可能已在运行）");

if (json) {
  console.log(JSON.stringify({ ok: checks.filter((c) => c.required).every((c) => c.ok), checks }, null, 2));
} else {
  console.log("\n口播工坊 · 环境体检\n");
  for (const item of checks) {
    console.log(`${item.ok ? "✓" : item.required ? "✗" : "·"} ${item.label.padEnd(12)} ${item.text}`);
  }
  const failed = checks.filter((c) => c.required && !c.ok);
  console.log("");
  if (failed.length) {
    console.log(`需要处理：${failed.map((c) => c.label).join("、")}`);
    console.log("运行 npm run setup 重新配置，或查看 SKILL.md 的安装章节。\n");
    process.exitCode = 1;
  } else {
    console.log("核心环境已就绪。运行 npm start 打开工作台。\n");
  }
}
