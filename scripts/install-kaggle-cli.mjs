#!/usr/bin/env node
/**
 * 预装 Kaggle CLI（不需要任何 token）
 *
 * 目的：把 kaggle 命令装进项目私有 venv（pipeline/tts/.venv-kaggle），
 * 让「部署」和「登录」彻底解耦——部署阶段先装好工具，之后只补一份凭据就能通。
 *
 * 用法：
 *   node scripts/install-kaggle-cli.mjs            # 幂等安装，已可用则跳过
 *   node scripts/install-kaggle-cli.mjs --force    # 强制重装
 *   node scripts/install-kaggle-cli.mjs --json     # 机器可读输出
 *
 * 凭据不在这里处理。装完后二选一：
 *   kaggle auth login                       # 浏览器登录，写 ~/.kaggle/access_token
 *   把 API Token 放到 ~/.kaggle/kaggle.json
 * 也支持 KAGGLE_USERNAME / KAGGLE_KEY 环境变量。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENV = path.join(ROOT, "pipeline", "tts", ".venv-kaggle");
const WIN = process.platform === "win32";
const BIN = (name) => path.join(VENV, WIN ? "Scripts" : "bin", WIN ? `${name}.exe` : name);
const force = process.argv.includes("--force");
const asJson = process.argv.includes("--json");

const log = (msg) => {
  if (!asJson) console.log(msg);
};

function which(cmd) {
  const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout.split(/\r?\n/)[0] || "").trim() : "";
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: asJson ? "pipe" : "inherit", encoding: "utf8", ...opts });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function cliProbe() {
  const bin = BIN("kaggle");
  if (!fs.existsSync(bin)) return { version: "", error: "missing" };
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 60000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0) return { version: "", error: out.split(/\r?\n/).filter(Boolean).pop() || "exit " + r.status };
  return { version: out.split(/\r?\n/).filter(Boolean).pop() || "", error: "" };
}

const cliVersion = () => cliProbe().version;

function done(payload) {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log("");
    console.log(`Kaggle CLI：${payload.version || "未安装"}  ${payload.ok ? "✓" : "✗"}`);
    console.log(`路径：${payload.bin}`);
    if (payload.ok) {
      console.log("");
      console.log("还没配凭据也能装到这里。要用的时候二选一：");
      console.log("  kaggle auth login                      # 浏览器登录，写 ~/.kaggle/access_token");
      console.log("  把 API Token 存成 ~/.kaggle/kaggle.json");
      console.log("装完跑 npm run doctor 复核。");
    }
    console.log("");
  }
  process.exit(payload.ok ? 0 : 1);
}

// 1. 已经能用就不折腾
if (!force && cliVersion()) {
  log("Kaggle CLI 已就绪，跳过安装（--force 可强制重装）。");
  done({ ok: true, skipped: true, version: cliVersion(), bin: BIN("kaggle"), venv: VENV });
}

log("口播工坊 · 预装 Kaggle CLI（无需 token）");
log(`目标目录：${VENV}`);

// 2. 建 venv + 安装，优先 uv（快），回退 python -m venv + pip
const uv = which("uv");
const python = which(WIN ? "python" : "python3") || which("python");
let installed = false;
let via = "";

// kaggle 2.x 的 wheel 漏声明 six（上游已知问题），必须一起装，否则 import 直接炸
const PKGS = ["kaggle", "six"];

if (uv) {
  via = "uv";
  if (!fs.existsSync(BIN("python"))) {
    run(uv, ["venv", VENV, "--python", "3.12", "--allow-existing"]);
  }
  installed = run(uv, ["pip", "install", "--python", BIN("python"), "--upgrade", ...PKGS]).ok;
} else if (python) {
  via = "venv+pip";
  if (!fs.existsSync(BIN("python"))) run(python, ["-m", "venv", VENV]);
  run(BIN("python"), ["-m", "pip", "install", "--upgrade", "pip"]);
  installed = run(BIN("python"), ["-m", "pip", "install", "--upgrade", ...PKGS]).ok;
} else {
  log("找不到 uv 或 python，无法安装。装一个 python3 后重试。");
  done({ ok: false, error: "no-python", version: "", bin: BIN("kaggle"), venv: VENV });
}

if (!installed) {
  log("安装失败，检查网络或代理。也可手动：uv pip install --python " + BIN("python") + " kaggle");
  done({ ok: false, error: "install-failed", via, version: cliVersion(), bin: BIN("kaggle"), venv: VENV });
}

const probe = cliProbe();
if (!probe.version) {
  log(`装完了但 kaggle --version 跑不起来：${probe.error || "未知错误"}`);
  log("可手动排查：" + BIN("kaggle") + " --version");
  done({ ok: false, error: "verify-failed", detail: probe.error, via, version: "", bin: BIN("kaggle"), venv: VENV });
}

log(`安装方式：${via}`);
done({ ok: true, skipped: false, via, version: probe.version, bin: BIN("kaggle"), venv: VENV });
