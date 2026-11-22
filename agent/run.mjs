import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function arg(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const jobFile = arg("job") || args.find((value) => !value.startsWith("--")) || "";
if (!jobFile) {
  console.error("用法: node agent/run.mjs --job job.json [--server http://127.0.0.1:4310] [--no-start-server]");
  process.exit(1);
}

const serverUrl = String(arg("server", process.env.OD_UI_URL || "http://127.0.0.1:4310")).replace(/\/+$/, "");
const startServer = !args.includes("--no-start-server");
const pollMs = Math.max(500, Number(arg("poll", "1000")) || 1000);
const timeoutMs = Math.max(60, Number(arg("timeout-min", "120")) || 120) * 60 * 1000;

const specPath = path.isAbsolute(jobFile) ? jobFile : path.join(ROOT, jobFile);
let spec;
try {
  spec = JSON.parse(fs.readFileSync(specPath, "utf8").replace(/^\uFEFF/, ""));
} catch (err) {
  console.error(`无法读取 Job Spec：${specPath}`);
  console.error(err?.message || err);
  process.exit(1);
}
if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
  console.error("Job Spec 必须是 JSON 对象");
  process.exit(1);
}
if (!spec.script && !spec.scriptFile) {
  console.error("Job Spec 缺少 script 或 scriptFile");
  process.exit(1);
}

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(pathname, options = {}) {
  const res = await fetch(`${serverUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function ensureServer() {
  try {
    await request("/api/bootstrap");
    return false;
  } catch {
    if (!startServer) throw new Error(`服务未启动：${serverUrl}`);
  }
  const port = new URL(serverUrl).port || "4310";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, OD_UI_PORT: port },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      await request("/api/bootstrap");
      return true;
    } catch {}
  }
  throw new Error("控制台服务启动超时");
}

function summarize(job) {
  return {
    event: "status",
    id: job.id,
    status: job.status,
    stage: job.stage,
    note: job.note,
    progress: job.progress,
    error: job.error || "",
  };
}

try {
  const started = await ensureServer();
  if (started) emit({ event: "server", url: serverUrl, started: true });

  const run = await request("/api/agent/run", {
    method: "POST",
    body: JSON.stringify(spec),
  });
  emit({ event: "accepted", id: run.id, outputDir: run.outputDir });

  const startedAt = Date.now();
  let last = "";
  let job = null;
  while (Date.now() - startedAt < timeoutMs) {
    const data = await request("/api/run");
    job = data.job;
    if (!job) {
      await sleep(pollMs);
      continue;
    }
    const line = summarize(job);
    const fingerprint = `${line.status}|${line.stage}|${line.note}|${Math.round((line.progress || 0) * 100)}`;
    if (fingerprint !== last) {
      last = fingerprint;
      emit(line);
    }
    if (job.status === "done") break;
    if (job.status === "error") {
      emit({ event: "error", id: job.id, error: job.error || "生成失败" });
      process.exitCode = 2;
      break;
    }
    if (job.status === "canceled") {
      emit({ event: "canceled", id: job.id });
      process.exitCode = 130;
      break;
    }
    await sleep(pollMs);
  }

  if (!job) throw new Error("没有拿到任务状态");
  if (job.status === "done") {
    const detail = await request(`/api/runs/${encodeURIComponent(job.id)}`);
    const record = detail.job || job;
    emit({
      event: "done",
      id: record.id,
      finalVideo: record.finalVideo || "",
      outputDir: record.dir || "",
      duration: record.duration || null,
      size: record.size || null,
      provider: record.provider || "",
    });
  } else if (Date.now() - startedAt >= timeoutMs) {
    emit({ event: "timeout", id: job.id, timeoutMin: timeoutMs / 60000 });
    process.exitCode = 3;
  }
} catch (err) {
  emit({ event: "error", error: err?.message || String(err) });
  process.exitCode = 1;
}
