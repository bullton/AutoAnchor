import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { files, paths } from "./config.mjs";

if (!fs.existsSync(files.slidesTimed)) {
  console.error(`缺少 ${files.slidesTimed}，请先运行 timeline 步骤`);
  process.exit(1);
}

const bin = path.join(
  paths.remotion,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "remotion.cmd" : "remotion",
);

const args = [
  "render",
  "src/index.ts",
  "OralVideo",
  files.silentVideo,
  `--props=${files.slidesTimed}`,
  "--codec=h264",
  "--crf=18",
  "--pix-fmt=yuv420p",
  "--overwrite",
  "--concurrency=2",
];

console.log("渲染中（首次会下载 Chromium，请耐心等待）...");
const child = spawn(bin, args, {
  cwd: paths.remotion,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`渲染失败，退出码 ${code}`);
    process.exit(code ?? 1);
  }
  console.log(`渲染完成：${files.silentVideo}`);
});
