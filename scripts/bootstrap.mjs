import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const passthrough = process.argv.slice(2).filter((arg) => arg !== "--bootstrap");
const yes = passthrough.includes("--yes") || passthrough.includes("-y");
const skipModels = passthrough.includes("--skip-models");

function step(title, args) {
  console.log("");
  console.log(`── ${title} ──`);
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: ROOT, windowsHide: true });
  if (result.status !== 0) {
    console.log(`步骤失败：${title}`);
    process.exit(result.status ?? 1);
  }
}

step("环境预检", [path.join(ROOT, "scripts", "preflight.mjs"), ...(skipModels ? ["--skip-models"] : []), ...(yes ? ["--no-prompt"] : [])]);
step("私有参数配置", [path.join(ROOT, "setup.mjs"), ...(yes ? ["--yes"] : [])]);
step("环境体检", [path.join(ROOT, "doctor.mjs")]);

console.log("");
console.log("初始化完成：npm start 打开控制台。");
console.log("如需数字人，再运行 npm run setup:kaggle 并配置 Kaggle 凭据。");
