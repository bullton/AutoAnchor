import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { avatarRect, files, paths } from "./config.mjs";

for (const f of [files.silentVideo, files.voice, files.subtitlesAss]) {
  if (!fs.existsSync(f)) {
    console.error(`缺少合成输入：${f}`);
    process.exit(1);
  }
}

const avatarPath = path.join(paths.output, "avatar.mp4");
let renderedByRemotion = false;
let overlayLayout = null;
try {
  const props = JSON.parse(fs.readFileSync(files.slidesTimed, "utf8"));
  const layout = props?.layout;
  renderedByRemotion = layout?.mode && layout.mode !== "none" && Boolean(layout?.avatar?.src);
  if (layout) overlayLayout = layout;
} catch {}
const useAvatar = !renderedByRemotion && fs.existsSync(avatarPath);
const assRel = path.relative(paths.root, files.subtitlesAss).replace(/\\/g, "/");

const outArgs = [
  "-y",
  "-hide_banner",
  "-loglevel", "error",
  "-guess_layout_max", "0",
  "-i", files.silentVideo,
  "-i", files.voice,
];

if (useAvatar) {
  const box = avatarRect(
    overlayLayout || { avatar: { width: 0.62, x: 0.5, y: 0.8, aspect: 1.317 } },
  );
  const filter = [
    `[2:v]scale=${box.width}:${box.height}:force_original_aspect_ratio=decrease,` +
      `pad=${box.width}:${box.height}:(ow-iw)/2:(oh-ih)/2:color=0x10151C[av]`,
    `[0:v][av]overlay=${box.x}:${box.y}:eof_action=pass[comp]`,
    `[comp]subtitles=${assRel},scale=in_range=full:out_range=limited,format=yuv420p[v]`,
  ].join(";");

  outArgs.push(
    "-stream_loop", "-1",
    "-i", avatarPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a:0",
  );
  console.log(`叠加外部数字人：${box.width}x${box.height} @ ${box.x},${box.y}`);
} else {
  outArgs.push(
    "-vf", `subtitles=${assRel},scale=in_range=full:out_range=limited,format=yuv420p`,
    "-map", "0:v:0",
    "-map", "1:a:0",
  );
}

outArgs.push(
  "-c:v", "libx264",
  "-preset", "medium",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "128k",
  "-ar", "48000",
  "-ac", "1",
  "-movflags", "+faststart",
  "-shortest",
  files.finalVideo,
);

console.log("合成音轨并烧录字幕...");
const child = spawn("ffmpeg", outArgs, { cwd: paths.root, stdio: "inherit" });

child.on("exit", (code) => {
  if (code !== 0) {
    console.error(`合成失败，退出码 ${code}`);
    process.exit(code ?? 1);
  }
  console.log(`成片完成：${files.finalVideo}`);
});
