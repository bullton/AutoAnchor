import { spawn } from "node:child_process";
import { paths } from "./config.mjs";

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const script = getArg("script");
const provider = getArg("provider");
const pagePause = getArg("page-pause");
const digital = process.argv.includes("--digital");
const digitalReference = getArg("digital-reference", "");
const digitalVariant = getArg("digital-variant", "closeup");

const work = [
  { name: "生成分镜", cmd: process.execPath, args: ["pipeline/01_storyboard.mjs", ...(script ? ["--script", script] : [])] },
  { name: "合成配音", cmd: process.execPath, args: ["pipeline/02_tts.mjs", ...(provider ? ["--provider", provider] : []), ...(pagePause ? ["--page-pause", pagePause] : [])] },
];
if (digital) {
  work.push({
    name: "生成数字人",
    cmd: process.execPath,
    args: [
      "pipeline/digital_human.mjs",
      ...(digitalReference ? ["--reference", digitalReference] : []),
      "--variant", digitalVariant,
    ],
  });
}
work.push(
  { name: "对齐时间轴与字幕", cmd: process.execPath, args: ["pipeline/03_timeline.mjs"] },
  { name: "渲染动画", cmd: process.execPath, args: ["pipeline/04_render.mjs"] },
  { name: "合成成片", cmd: process.execPath, args: ["pipeline/05_compose.mjs"] },
);
const steps = work.map((step, index) => ({ ...step, name: `${index + 1}/${work.length} ${step.name}` }));

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${step.name} ===`);
    const child = spawn(step.cmd, step.args, { cwd: paths.root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.name} 失败，退出码 ${code}`));
    });
  });
}

for (const step of steps) {
  await runStep(step);
}

console.log("\n全部完成：output/final.mp4");
