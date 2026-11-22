#!/usr/bin/env node
/**
 * 口播工坊 · 部署引导（preflight）
 *
 * 部署阶段只做三件事：先探测，再判断适配，最后才问用户要不要装。
 *   - Remotion：纯本地，必需，不联网（首次渲染才拉 Chromium）
 *   - Kaggle：外部服务，引导装 CLI + 配 token；没 token 也能先把 CLI 装好
 *   - 本地模型：先测内存/磁盘/显卡，够用才提示；用户点头才下载；不点头就走第三方
 *
 * 用法：
 *   node scripts/preflight.mjs                 # 交互引导
 *   node scripts/preflight.mjs --json          # 只输出探测与判定结果，不改任何东西
 *   node scripts/preflight.mjs --no-prompt     # 用默认值（不装本地模型），直接落配置
 *   node scripts/preflight.mjs --install=cosyvoice,indextts   # 非交互指定要装哪些
 *   node scripts/preflight.mjs --dry-run       # 只打印将执行的命令
 *   node scripts/preflight.mjs --mirror        # 下载走 hf-mirror.com
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { privatePaths, readPrivate, writePrivate } from "../pipeline/private.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const arg = (name, fallback = "") => {
  const hit = argv.find((item) => item === `--${name}` || item.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const i = argv.indexOf(hit);
  return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
};

const JSON_OUT = has("--json");
const NO_PROMPT = has("--no-prompt") || JSON_OUT;
const DRY = has("--dry-run");
const MIRROR = has("--mirror") || Boolean(process.env.HF_ENDPOINT);
const installArg = String(arg("install", "") || "").trim();
const FORCE_INSTALL = installArg && installArg !== "none" ? new Set(installArg.split(",").map((s) => s.trim())) : null;
const SKIP_MODELS = installArg === "none";

const GB = 1e9;          // 权重体积用十进制（与 Hugging Face 显示一致）
const GiB = 1024 ** 3;   // 内存/磁盘用二进制（与系统「关于本机」一致）
const gb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;
const gib = (bytes) => `${(bytes / GiB).toFixed(1)} GB`;
const src = (p) => path.relative(ROOT, p) || ".";

// ── 组件清单：体积取自 Hugging Face 仓库实测（2026-11） ─────────────────────
const MODELS = [
  {
    id: "cosyvoice",
    label: "CosyVoice2-0.5B",
    provider: "cosyvoice",
    repo: "FunAudioLLM/CosyVoice2-0.5B",
    weights: 4.86 * GB,
    extra: 1.6 * GB, // vendor 源码 + 依赖
    ramNeed: 8 * GB,
    ramRec: 12 * GB,
    target: "models/CosyVoice2-0.5B",
    note: "0.5B 小模型，MPS/CPU 都能跑，中文克隆效果好",
    after: [
      "git clone https://github.com/FunAudioLLM/CosyVoice.git vendor/CosyVoice",
      "uv venv vendor/CosyVoice/.venv --python 3.10",
      "uv pip install -r vendor/CosyVoice/requirements.txt --python vendor/CosyVoice/.venv/bin/python",
    ],
  },
  {
    id: "indextts",
    label: "IndexTTS-2.5",
    provider: "indextts",
    repo: "IndexTeam/IndexTTS-2.5",
    weights: 5.49 * GB,
    extra: 2 * GB,
    ramNeed: 16 * GB,
    ramRec: 24 * GB,
    target: "models/IndexTTS-2.5",
    note: "情感与韵律更自然，显存/内存吃得更多",
    after: [
      "git clone https://github.com/index-tts/index-tts.git vendor/index-tts",
      "按 vendor/index-tts/README 建 3.10 环境并安装依赖",
    ],
  },
];

// Remotion 的本地依赖目录（Chromium 缓存在用户目录，首次渲染才拉）
const REMOTION = { nodeModules: path.join(ROOT, "remotion", "node_modules") };

function which(cmd) {
  try {
    const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? (r.stdout.split(/\r?\n/)[0] || "").trim() : "";
  } catch {
    return "";
  }
}

function run(cmd, args, opts = {}) {
  if (DRY) return { ok: true, dry: true, stdout: "", stderr: "" };
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function freeDisk(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return 0;
  }
}

function cpuName() {
  if (process.platform === "darwin") {
    const r = spawnSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" });
    return (r.stdout || "").trim() || os.cpus()[0]?.model || "Apple Silicon";
  }
  return os.cpus()[0]?.model?.trim() || "未知 CPU";
}

function gpuInfo() {
  const nv = spawnSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], {
    encoding: "utf8",
    timeout: 4000,
  });
  if (nv.status === 0 && nv.stdout.trim()) {
    const [name, mem] = nv.stdout.trim().split(/\r?\n/)[0].split(",").map((s) => s.trim());
    return { kind: "cuda", name: `${name}（${mem}）`, vram: Number((mem || "").replace(/[^\d]/g, "")) * 1024 * 1024 || 0 };
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    const sp = spawnSync("system_profiler", ["SPDisplaysDataType"], { encoding: "utf8", timeout: 8000 });
    const chip = (sp.stdout || "").match(/Chipset Model:\s*(.+)/)?.[1]?.trim() || "Apple GPU";
    // Apple 统一内存，可用显存≈内存的 2/3
    return { kind: "mps", name: `${chip}（Metal / 统一内存）`, vram: os.totalmem() * 0.66 };
  }
  return { kind: "cpu", name: "无独立显卡，走 CPU", vram: 0 };
}

function detect() {
  const priv = readPrivate();
  const local = privatePaths(priv);
  const hw = {
    os: `${process.platform}-${process.arch}`,
    cpu: cpuName(),
    cores: os.cpus().length,
    ram: os.totalmem(),
    freeDisk: freeDisk(ROOT),
    gpu: gpuInfo(),
  };
  const ffmpegBin = local.ffmpeg && fs.existsSync(local.ffmpeg) ? local.ffmpeg : which("ffmpeg");
  const filterList = ffmpegBin ? (run(ffmpegBin, ["-hide_banner", "-filters"], { timeout: 8000 }).stdout || "") : "";
  const hasSubtitles = Boolean(ffmpegBin) && /\bsubtitles\b/.test(filterList) && /\bass\b/.test(filterList);
  const components = {
    remotion: {
      kind: "local-required",
      label: "Remotion 渲染（纯本地）",
      ok: fs.existsSync(REMOTION.nodeModules),
      detail: fs.existsSync(REMOTION.nodeModules) ? "依赖已安装" : "缺 remotion/node_modules",
      fix: "npm --prefix remotion install",
      note: "不上传、不联网；首次渲染会下载 Chromium（约 150–300 MB，缓存在本机）",
    },
    ffmpeg: {
      kind: "local-required",
      label: "FFmpeg 字幕能力",
      ok: hasSubtitles,
      bin: ffmpegBin || "ffmpeg",
      detail: hasSubtitles ? `${path.basename(ffmpegBin || "ffmpeg")} · subtitles/ass 可用` : "缺少 subtitles 或 ass 滤镜",
      fix: "用 ffmpeg-static 的 6.0 静态版（vendor/ffmpeg），或安装带 libass 的 ffmpeg",
      note: "系统版 ffmpeg 可能没有 libass，烧字幕会失败；探测与合成应尽量使用同一个二进制",
    },
    kaggle: {
      kind: "external",
      label: "Kaggle 云 GPU（外部）",
      cli: local.kaggleBin && fs.existsSync(local.kaggleBin) ? local.kaggleBin : which("kaggle") || "",
      cliOk: Boolean(local.kaggleBin && fs.existsSync(local.kaggleBin)) || Boolean(which("kaggle")),
      token: Boolean(
        String(priv.kaggle?.username || "").trim() && String(priv.kaggle?.key || priv.kaggle?.token || "").trim(),
      ) || ["access_token", "kaggle.json"].some((n) => {
        try {
          return fs.statSync(path.join(os.homedir(), ".kaggle", n)).size > 20;
        } catch {
          return false;
        }
      }),
      fixCli: "npm run setup:kaggle",
      fixToken: "kaggle auth login   # 或把 API Token 存成 ~/.kaggle/kaggle.json",
      note: "数字人口型、Kaggle 配音都靠它；本机不落权重，配额 30h/周",
    },
    edge: {
      kind: "third-party",
      label: "Edge-TTS（第三方，零权重）",
      ok: (() => {
        const py = local.python || "python3";
        const r = spawnSync(py, ["-c", "import edge_tts"], { encoding: "utf8", timeout: 8000 });
        return r.status === 0;
      })(),
      fix: "pip install edge-tts（约 30 MB）",
      note: "不用任何本地模型和显存，免费无 Key；音色固定，不能克隆",
    },
  };
  return { hw, priv, local, components };
}

function judge(model, hw) {
  const need = model.weights + model.extra;
  const reasons = [];
  let level = "ok";
  if (hw.freeDisk < need) {
    level = "no";
    reasons.push(`磁盘不足：需要 ${gb(need)}，可用 ${gib(hw.freeDisk)}`);
  } else if (hw.freeDisk < need * 1.15 || hw.ram < model.ramRec) {
    level = "tight";
    if (hw.freeDisk < need * 1.15) reasons.push(`磁盘偏紧：需要 ${gb(need)}，建议留 ${gb(need * 1.15)}`);
    if (hw.ram < model.ramRec) reasons.push(`内存 ${gib(hw.ram)} 低于推荐 ${gib(model.ramRec)}，可跑但慢`);
  }
  if (hw.ram < model.ramNeed) {
    level = "no";
    reasons.push(`内存不足：最低 ${gib(model.ramNeed)}，当前 ${gib(hw.ram)}`);
  }
  return { level, need, reasons };
}

function printReport({ hw, components }) {
  console.log("");
  console.log("口播工坊 · 部署引导");
  console.log("");
  console.log(`本机：${hw.cpu} · ${hw.cores} 核 · 内存 ${gib(hw.ram)} · 可用磁盘 ${gib(hw.freeDisk)}`);
  console.log(`显卡：${hw.gpu.name}`);
  console.log("");
  console.log("── 必需（纯本地） ──");
  const r = components.remotion;
  console.log(`${r.ok ? "✓" : "✗"} ${r.label}：${r.detail}`);
  if (!r.ok) console.log(`   修复：${r.fix}`);
  const f = components.ffmpeg;
  console.log(`${f.ok ? "✓" : "✗"} ${f.label}：${f.detail}（${f.bin}）`);
  if (!f.ok) console.log(`   修复：${f.fix}`);
  console.log("");
  console.log("── 外部服务（要引导配置） ──");
  const k = components.kaggle;
  console.log(`${k.cliOk ? "✓" : "·"} Kaggle CLI：${k.cliOk ? k.cli : "未安装"}`);
  console.log(`${k.token ? "✓" : "·"} Kaggle 凭据：${k.token ? "已配置" : "未配置（CLI 可先装，token 后补）"}`);
  if (!k.cliOk) console.log(`   安装：${k.fixCli}`);
  if (!k.token) console.log(`   配置：${k.fixToken}`);
  const e = components.edge;
  console.log(`${e.ok ? "✓" : "·"} Edge-TTS：${e.ok ? "可用" : "未安装"}`);
  console.log("");
  console.log("── 本地模型（要先判断适配） ──");
  for (const m of MODELS) {
    const v = judge(m, hw);
    const mark = v.level === "ok" ? "✓" : v.level === "tight" ? "!" : "✗";
    console.log(`${mark} ${m.label}：${gb(v.need)}（含依赖）`);
    console.log(`   ${m.note}`);
    if (v.reasons.length) v.reasons.forEach((line) => console.log(`   - ${line}`));
  }
  console.log("");
  console.log("不装任何本地模型 = 纯第三方：配音走 Edge-TTS 或 Kaggle，数字人走 Kaggle。");
}

// ── 安装动作 ────────────────────────────────────────────────────────────────
function hfDownload(repo, target, log) {
  const dest = path.join(ROOT, target);
  if (DRY) {
    log(`[dry-run] 将下载 ${repo} → ${target}`);
    return true;
  }
  fs.mkdirSync(dest, { recursive: true });
  const env = { ...process.env, ...(MIRROR ? { HF_ENDPOINT: process.env.HF_ENDPOINT || "https://hf-mirror.com" } : {}) };
  const py = process.env.OD_PYTHON || "";
  const script =
    `from huggingface_hub import snapshot_download;` +
    `snapshot_download(repo_id=${JSON.stringify(repo)}, local_dir=${JSON.stringify(dest)}, max_workers=8)`;

  if (which("uv")) {
    log(`uv 下载中：${repo} → ${target}`);
    const r = run("uv", ["run", "--with", "huggingface_hub", "python", "-c", script], { env, stdio: "inherit" });
    if (r.ok) return true;
    log("uv 方式失败，回退 python -m pip");
  }
  if (py && fs.existsSync(py)) {
    log(`python 下载中：${repo} → ${target}`);
    if (!DRY) run(py, ["-m", "pip", "install", "--quiet", "--upgrade", "huggingface_hub"], { env });
    const r = run(py, ["-c", script], { env, stdio: "inherit" });
    return r.ok;
  }
  log("找不到可用的 python 或 uv，无法下载。手动：pip install huggingface_hub 后 snapshot_download");
  return false;
}

function ensureEdge(local, log) {
  const py = local.python || which("python3") || which("python");
  if (!py) {
    log("找不到 python，无法安装 edge-tts。");
    return false;
  }
  log(`安装 edge-tts：${py} -m pip install edge-tts`);
  const r = run(py, ["-m", "pip", "install", "--quiet", "--upgrade", "edge-tts"]);
  if (!r.ok) {
    log(`安装失败：${(r.stderr || r.stdout || "").trim().split(/\r?\n/).pop() || "未知错误"}`);
    return false;
  }
  return true;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const state = detect();
const verdicts = Object.fromEntries(MODELS.map((m) => [m.id, judge(m, state.hw)]));
const actions = { install: [], skipped: [], edge: false, kaggleCli: false };

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        hardware: {
          os: state.hw.os,
          cpu: state.hw.cpu,
          cores: state.hw.cores,
          ramGB: Number((state.hw.ram / GiB).toFixed(1)),
          freeDiskGB: Number((state.hw.freeDisk / GiB).toFixed(1)),
          gpu: state.hw.gpu,
        },
        remotion: state.components.remotion,
        ffmpeg: state.components.ffmpeg,
        kaggle: state.components.kaggle,
        edge: state.components.edge,
        models: MODELS.map((m) => ({
          id: m.id,
          label: m.label,
          repo: m.repo,
          weightsGB: Number((m.weights / GB).toFixed(2)),
          needGB: Number((verdicts[m.id].need / GB).toFixed(2)),
          ramNeedGB: Number((m.ramNeed / GiB).toFixed(1)),
          ramRecGB: Number((m.ramRec / GiB).toFixed(1)),
          level: verdicts[m.id].level,
          reasons: verdicts[m.id].reasons,
          target: m.target,
        })),
        recommendation: MODELS.filter((m) => verdicts[m.id].level !== "no").map((m) => m.id),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

printReport(state);

// 必需项：Remotion 没装就直接给命令
if (!state.components.remotion.ok) {
  console.log(`请先安装渲染依赖：${state.components.remotion.fix}`);
}

// 非交互环境（管道/CI）不猜用户的意愿，只报告、不落配置
if (!process.stdin.isTTY && !NO_PROMPT && !FORCE_INSTALL && !SKIP_MODELS) {
  console.log("（当前不是交互终端，未做任何改动）");
  console.log("要非交互执行：--no-prompt 用默认值，或 --install=cosyvoice,indextts 指定，--dry-run 先看命令。");
  console.log("");
  process.exit(0);
}

const rl = NO_PROMPT ? null : createInterface({ input: process.stdin, output: process.stdout });
let rlClosed = false;
rl?.on("close", () => {
  rlClosed = true;
});
const askYes = async (label, fallback = false) => {
  if (NO_PROMPT) return FORCE_INSTALL ? FORCE_INSTALL.size > 0 : fallback;
  if (rlClosed) return fallback;
  const hint = fallback ? "[Y/n]" : "[y/N]";
  // stdin 提前 EOF 时 question() 的 Promise 不会 settle，必须和 close 事件竞速
  const answered = rl
    .question(`${label} ${hint} `)
    .then((a) => {
      const text = String(a || "").trim().toLowerCase();
      return text ? text.startsWith("y") : fallback;
    })
    .catch(() => fallback);
  const closed = new Promise((resolve) => rl.once("close", () => resolve(fallback)));
  return Promise.race([answered, closed]);
};

console.log("");
console.log("── 逐项确认 ──");

// 1. Kaggle CLI（不需要 token 就能装）
const k = state.components.kaggle;
if (!k.cliOk) {
  if (await askYes("先装 Kaggle CLI？（不需要 token，装完再补凭据）", true)) {
    const r = run(process.execPath, [path.join(ROOT, "scripts", "install-kaggle-cli.mjs"), ...(DRY ? ["--json"] : [])], {
      stdio: DRY ? "pipe" : "inherit",
    });
    actions.kaggleCli = r.ok;
    if (!r.ok) console.log("  Kaggle CLI 安装失败，稍后可重试 npm run setup:kaggle");
  } else actions.skipped.push("kaggle-cli");
} else {
  console.log(`✓ Kaggle CLI 已就绪：${k.cli}`);
}
if (!k.token) console.log("  凭据还没配。之后跑：kaggle auth login（或放 ~/.kaggle/kaggle.json）");

// 2. 本地模型：只有判定可装/勉强可装才问
const chosen = [];
for (const m of MODELS) {
  const v = verdicts[m.id];
  if (v.level === "no") {
    console.log(`✗ ${m.label} 跳过：${v.reasons.join("；")}`);
    continue;
  }
  const already = ["llm.pt", "config.yaml", "gpt.pth"].some((f) => fs.existsSync(path.join(ROOT, m.target, f)));
  if (already) {
    console.log(`✓ ${m.label} 目录里已有权重，跳过下载`);
    chosen.push(m.id);
    continue;
  }
  const tag = v.level === "tight" ? "（配置吃紧，可跑但慢）" : "";
  const pick = FORCE_INSTALL
    ? FORCE_INSTALL.has(m.id)
    : SKIP_MODELS
      ? false
      : await askYes(`安装 ${m.label}？占 ${gb(v.need)}${tag}`, false);
  if (!pick) {
    actions.skipped.push(m.id);
    continue;
  }
  chosen.push(m.id);
}

// 3. 执行下载（用户点头之后才动）
console.log("");
if (chosen.length) {
  console.log("── 开始下载 ──");
  for (const id of chosen) {
    const m = MODELS.find((x) => x.id === id);
    const ok = hfDownload(m.repo, m.target, (line) => console.log(line));
    actions.install.push({ id, ok });
    if (ok && !DRY) {
      console.log(`✓ ${m.label} 权重已就位：${m.target}`);
      if (m.after?.length) {
        console.log("  还差运行环境（权重不含依赖）：");
        m.after.forEach((line) => console.log(`    ${line}`));
      }
    }
  }
}

// 4. 一个本地模型都没装 → 纯第三方，顺手把最轻的兜底装好
let provider = readPrivate().tts?.provider || "voicestudio";
if (!chosen.length) {
  console.log("");
  console.log("没选本地模型，按纯第三方处理。");
  const useEdge = await askYes("装 Edge-TTS 作为配音兜底？（约 30 MB，免 Key）", true);
  if (useEdge) {
    actions.edge = ensureEdge(state.local, (line) => console.log(line));
    if (actions.edge) {
      provider = "edge";
      console.log("✓ Edge-TTS 可用，配音方案已切到 edge");
    }
  } else {
    provider = "kaggle";
    console.log("配音方案已切到 kaggle（需要 token；数字人本来就走 Kaggle）");
  }
} else {
  provider = MODELS.find((m) => m.id === chosen[0]).provider;
  console.log("");
  console.log(`配音方案：${provider}（本地）`);
}

// 5. 落配置
if (!DRY) {
  writePrivate({ tts: { provider } });
  console.log(`配置已写入 config/private.json：tts.provider = ${provider}`);
} else {
  console.log(`[dry-run] 将写入 tts.provider = ${provider}`);
}

if (rl) rl.close();

console.log("");
console.log("── 下一步 ──");
if (!state.components.remotion.ok) console.log(`1. ${state.components.remotion.fix}`);
console.log(`${state.components.remotion.ok ? "1" : "2"}. 放 3–10 秒本人录音到 assets/voice-ref/（克隆类配音必需，Edge 不需要）`);
console.log(`   npm run doctor 复核环境`);
console.log(`   npm start 打开控制台`);
console.log("");
