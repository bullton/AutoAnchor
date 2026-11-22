import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths, ROOT } from "./config.mjs";
import { mergeTtsConfig, privatePaths } from "./private.mjs";

const outDir = process.env.OD_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.OD_OUTPUT_DIR)
  : paths.output;
fs.mkdirSync(outDir, { recursive: true });
const runtimeConfig = path.join(outDir, ".tts.config.json");
fs.writeFileSync(runtimeConfig, JSON.stringify(mergeTtsConfig(), null, 2), "utf8");

const local = privatePaths();
const args = ["pipeline/02_tts.py", "--config", runtimeConfig, ...process.argv.slice(2)];
const child = spawn(paths.python, args, {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    OD_ROOT: ROOT,
    OD_VOICESTUDIO_BACKEND: path.join(local.voiceStudioRoot, "backend"),
    OD_COSYVOICE_VENDOR: local.cosyvoiceVendor,
    OD_COSYVOICE_MODEL: local.cosyvoiceModel,
    OD_COSYVOICE3_MODEL: path.join(local.modelsRoot, "Fun-CosyVoice3-0.5B"),
    OD_COSYVOICE_PYTHON: path.join(local.cosyvoiceVendor, ".venv", "Scripts", "python.exe"),
    OD_INDEXTTS_REPO: local.indexttsRepo,
    OD_INDEXTTS_PYTHON: local.indexttsPython,
    OD_VOICEREF: local.voiceRef,
  },
});

child.on("error", (err) => {
  console.error(`无法启动 Python：${paths.python}`);
  console.error(err?.message || err);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
