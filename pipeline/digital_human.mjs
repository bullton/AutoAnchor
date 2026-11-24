import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, paths as projectPaths } from "./config.mjs";
import { privatePaths, readPrivate } from "./private.mjs";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function fail(message, code = 1) {
  console.error(`数字人失败：${message}`);
  process.exit(code);
}

function resolveFile(value, base = ROOT) {
  const text = String(value || "").trim();
  if (!text) return "";
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(base, text);
}

function pickVariant(summary, requested) {
  const variants = summary?.variants && typeof summary.variants === "object" ? summary.variants : {};
  if (requested && requested !== "auto") return requested;
  const ok = Object.keys(variants).find((name) => variants[name]?.ok);
  return ok || Object.keys(variants)[0] || "closeup";
}

function probeSize(summary, variant) {
  const probe = summary?.variants?.[variant]?.probe || {};
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((item) => item.codec_name === "h264") || streams.find((item) => item.width && item.height) || {};
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const duration = Number(probe?.format?.duration) || 0;
  return { width, height, aspect: width && height ? width / height : 0, duration };
}

const outRoot = process.env.OD_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.OD_OUTPUT_DIR)
  : projectPaths.output;
fs.mkdirSync(outRoot, { recursive: true });

const priv = readPrivate();
const local = privatePaths(priv);
const kaggle = priv.kaggle && typeof priv.kaggle === "object" ? priv.kaggle : {};

const reference = resolveFile(arg("reference"));
if (!reference) fail("缺少数字人参考视频（--reference）");
if (!fs.existsSync(reference)) fail(`参考视频不存在：${reference}`);
if (!VIDEO_EXTS.has(path.extname(reference).toLowerCase())) {
  fail("参考素材必须是视频（mp4 / mov / webm / mkv），不能用人像图片生成口型");
}

const voice = resolveFile(arg("voice", path.join(outRoot, "voice.wav")));
if (!fs.existsSync(voice) || fs.statSync(voice).size < 1024) fail(`找不到配音文件：${voice}`);

const variant = ["closeup", "fullbody", "auto"].includes(arg("variant")) ? arg("variant") : "closeup";
const runId = arg("run-id", new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14));
const runDir = path.join(outRoot, "digital-human");
const manifestFile = path.join(outRoot, "digital-human.json");
fs.mkdirSync(runDir, { recursive: true });

const python = [local.kagglePython, projectPaths.python].find((file) => file && fs.existsSync(file));
if (!python) fail("找不到可用的 Python，请在 setup 里填写 kagglePython 或 python");

const env = {
  ...process.env,
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};
const hasStoredCredentials = Boolean(kaggle.username && (kaggle.key || kaggle.token));
const hasProjectCredentials = ["kaggle.json", "access_token"].some((name) =>
  fs.existsSync(path.join(local.kaggleConfigDir, name)),
);
if (hasStoredCredentials || hasProjectCredentials) {
  env.KAGGLE_CONFIG_DIR = local.kaggleConfigDir;
}
if (kaggle.username) env.KAGGLE_USERNAME = String(kaggle.username);
if (kaggle.key || kaggle.token) env.KAGGLE_KEY = String(kaggle.key || kaggle.token);
if (hasStoredCredentials) {
  try {
    fs.mkdirSync(local.kaggleConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(local.kaggleConfigDir, "kaggle.json"),
      JSON.stringify({ username: String(kaggle.username), key: String(kaggle.key || kaggle.token) }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (err) {
    console.warn(`数字人：写入 Kaggle 临时凭据失败（${err?.message || err}），继续使用环境变量`);
  }
}
if (local.kaggleBin && fs.existsSync(local.kaggleBin)) {
  env.PATH = `${path.dirname(local.kaggleBin)}${path.delimiter}${env.PATH || ""}`;
}

const queueTimeoutMin = Math.max(0, Number(arg("queue-timeout-min", kaggle.queueTimeoutMin ?? 3)) || 0);
const queueRetries = Math.max(1, Number(arg("queue-retries", kaggle.queueRetries ?? 3)) || 3);

const args = [
  path.join(ROOT, "pipeline", "digital_human", "run.py"),
  "--video", reference,
  "--audio", voice,
  "--run-id", runId,
  "--output-dir", runDir,
  "--json-out", manifestFile,
  "--timeout", String(Math.max(10, Number(arg("timeout", kaggle.timeoutMin || 120)) || 120)),
  "--queue-timeout-min", String(queueTimeoutMin),
  "--queue-retries", String(queueRetries),
];
if (variant !== "auto") args.push("--only", variant);
if (kaggle.dataset) args.push("--dataset", String(kaggle.dataset));
if (kaggle.kernel && kaggle.kernel !== "latentsync-dual") args.push("--kernel", String(kaggle.kernel));
if (kaggle.accelerator && kaggle.accelerator !== "NvidiaTeslaT4") args.push("--accel", String(kaggle.accelerator));
if (arg("max-side")) args.push("--max-side", arg("max-side"));
if (arg("crop-pct")) args.push("--crop-pct", arg("crop-pct"));
if (kaggle.cli) args.push("--kaggle", String(kaggle.cli));

console.log(`数字人：Kaggle LatentSync · ${variant === "auto" ? "自动选版" : variant}`);
console.log(`参考视频：${reference}`);
console.log(`配音：${voice}`);
console.log(`Kaggle 账号：${kaggle.username || "自动探测"}`);

const child = spawn(python, args, { cwd: ROOT, env, windowsHide: true });
let tail = "";
const pipe = (stream) => {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        tail = line.trim();
        console.log(line);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.trim()) {
      tail = buffer.trim();
      console.log(buffer);
    }
  });
};
pipe(child.stdout);
pipe(child.stderr);

child.on("error", (err) => {
  console.error(`无法启动数字人任务：${err?.message || err}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    console.error(`数字人任务失败（退出码 ${code}）${tail ? `：${tail}` : ""}`);
    process.exit(code ?? 1);
  }
  let summary = {};
  try {
    summary = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch {}
  const chosen = pickVariant(summary, variant);
  const produced = path.join(runDir, runId, chosen, "video_out.mp4");
  if (!fs.existsSync(produced) || fs.statSync(produced).size < 1024) {
    fail(`成片未找到：${produced}`);
  }
  const dest = path.join(outRoot, "avatar.mp4");
  fs.copyFileSync(produced, dest);
  const size = probeSize(summary, chosen);
  const manifest = {
    version: 1,
    provider: "kaggle-latentsync",
    reference,
    voice,
    variant: chosen,
    video: dest,
    source: produced,
    width: size.width,
    height: size.height,
    aspect: Math.round(size.aspect * 1000) / 1000,
    duration: size.duration,
    kernel: summary.kernel || "",
    kernelUrl: summary.kernel_url || "",
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`数字人完成：${chosen} · ${size.width}x${size.height} · ${size.duration}s`);
  console.log(`数字人成片：${dest}`);
});
