#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LatentSync on Kaggle —— 一条命令跑通。

自动识别当前机器的 Kaggle 账号，把本地视频/音频上传成私有数据集，
生成 Notebook 运行配置并推送，等跑完后把成片下载到 results/<时间戳>/。

用法示例：
    python run.py                      # 用 inputs/ 里最新的视频和音频
    python run.py --video a.mp4 --audio b.wav
    python run.py --only closeup       # 只跑半身
    python run.py --no-run             # 只保存版本，不运行
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
NOTEBOOK = "latentsync_kaggle_t4x2.ipynb"
BUILD = os.path.join(ROOT, "build")
INPUTS = os.path.join(ROOT, "inputs")
RESULTS = os.path.join(ROOT, "results")
FINGERPRINT = os.path.join(BUILD, ".fingerprint.json")

VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg"}


def say(msg=""):
    print(msg, flush=True)


def die(msg, code=1):
    say("错误：" + msg)
    sys.exit(code)


def kaggle_bin(explicit):
    if explicit:
        return explicit.split()
    exe = shutil.which("kaggle")
    if exe:
        return [exe]
    uv = shutil.which("uv")
    if uv:
        try:
            r = subprocess.run([uv, "tool", "run", "kaggle", "--version"],
                               capture_output=True, text=True, timeout=120)
            if r.returncode == 0:
                return [uv, "tool", "run", "kaggle"]
        except Exception:
            pass
    die("找不到 kaggle 命令。安装：pip install kaggle  或  uv tool install kaggle --with six")


class K:
    def __init__(self, cmd):
        self.cmd = cmd

    def __call__(self, *args, quiet=False, timeout=None):
        full = self.cmd + [str(a) for a in args]
        r = subprocess.run(full, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout)
        if not quiet:
            for stream in (r.stdout, r.stderr):
                text = (stream or "").strip()
                if text:
                    say(text)
        return r


def resolve_username(k):
    r = k("config", "view", quiet=True)
    m = re.search(r"username:\s*(\S+)", r.stdout or "")
    if m and m.group(1).lower() not in ("none", ""):
        return m.group(1)
    env = os.environ.get("KAGGLE_USERNAME")
    if env:
        return env
    cfg = os.path.expanduser("~/.kaggle/kaggle.json")
    if os.path.isfile(cfg):
        try:
            name = json.load(open(cfg, encoding="utf-8")).get("username")
            if name:
                return name
        except Exception:
            pass
    die("无法确定 Kaggle 账号。先登录：kaggle auth login，"
        "或放置 ~/.kaggle/kaggle.json，或设置 KAGGLE_USERNAME / KAGGLE_KEY")


def pick_file(path, exts, kind, argname):
    if path:
        p = os.path.abspath(path)
        if not os.path.isfile(p):
            die(f"--{argname} 指向的文件不存在：{p}")
        if os.path.splitext(p)[1].lower() not in exts:
            say(f"提示：{os.path.basename(p)} 不在常见{kind}扩展名里，仍按{kind}上传")
        return p
    os.makedirs(INPUTS, exist_ok=True)
    cands = [os.path.join(INPUTS, f) for f in os.listdir(INPUTS)
             if os.path.splitext(f)[1].lower() in exts
             and os.path.isfile(os.path.join(INPUTS, f))]
    if not cands:
        die(f"没有找到{kind}文件。把文件放进 inputs/ 目录，或用 --{argname} 指定路径")
    cands.sort(key=os.path.getmtime, reverse=True)
    if len(cands) > 1:
        say(f"提示：inputs/ 里有多个{kind}，这次用最新的：{os.path.basename(cands[0])}")
        say("  其他：" + "、".join(os.path.basename(c) for c in cands[1:]))
    return cands[0]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def link_or_copy(src, dst):
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def dataset_files(k, ref):
    r = k("datasets", "files", ref, quiet=True)
    if r.returncode != 0:
        return None
    return r.stdout or ""


def wait_marker(k, ref, marker, timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        files = dataset_files(k, ref)
        if files and marker in files:
            return True
        time.sleep(10)
    return False


def prepare_dataset(k, args, ref, video, audio):
    stage = os.path.join(BUILD, "inputs")
    if os.path.isdir(stage):
        shutil.rmtree(stage)
    os.makedirs(stage, exist_ok=True)

    for src in (video, audio):
        link_or_copy(src, os.path.join(stage, os.path.basename(src)))

    manifest = {"video": os.path.basename(video), "audio": os.path.basename(audio)}
    with open(os.path.join(stage, "inputs.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    cfg = {}
    if args.only:
        cfg["variants"] = [s.strip() for s in args.only.split(",") if s.strip()]
    if args.max_side:
        cfg["max_side"] = args.max_side
    if args.crop_pct:
        cfg["crop_pct"] = args.crop_pct
    if args.crop_px:
        cfg["crop_px"] = args.crop_px
    if args.crop_out:
        cfg["crop_out"] = args.crop_out
    cfg_path = os.path.join(stage, "run-config.json")
    if cfg:
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

    with open(os.path.join(stage, "dataset-metadata.json"), "w", encoding="utf-8") as f:
        json.dump({"title": "LatentSync inputs", "id": ref,
                   "licenses": [{"name": "CC0-1.0"}]}, f, indent=2)

    fingerprint = {
        "ref": ref,
        "files": {os.path.basename(x): [os.path.getsize(x), sha256(x)]
                  for x in (video, audio)},
        "config": cfg,
    }
    marker = "upload-" + hashlib.sha256(
        json.dumps(fingerprint, sort_keys=True).encode("utf-8")).hexdigest()[:10] + ".json"
    with open(os.path.join(stage, marker), "w", encoding="utf-8") as f:
        json.dump({"fingerprint": fingerprint, "time": datetime.datetime.now().isoformat()},
                  f, ensure_ascii=False, indent=2)

    old = None
    if os.path.isfile(FINGERPRINT):
        try:
            old = json.load(open(FINGERPRINT, encoding="utf-8"))
        except Exception:
            old = None

    files = dataset_files(k, ref)
    if not args.force_upload and old == fingerprint and files and marker in files:
        say(f"素材未变化，直接复用数据集 {ref}")
        return ref

    exists = files is not None
    message = "update " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    say(f"{'更新' if exists else '创建'}私有数据集 {ref}（{os.path.getsize(video)/1024**2:.0f} MB 视频 + "
        f"{os.path.getsize(audio)/1024**2:.1f} MB 音频）...")
    if exists:
        r = k("datasets", "version", "-p", stage, "-m", message, "-q", timeout=3600)
    else:
        r = k("datasets", "create", "-p", stage, "-q", timeout=3600)
        if r.returncode != 0 and "already exists" in (r.stderr or "").lower():
            r = k("datasets", "version", "-p", stage, "-m", message, "-q", timeout=3600)
    if r.returncode != 0:
        die("数据集上传失败：\n" + (r.stderr or r.stdout or "").strip())

    with open(FINGERPRINT, "w", encoding="utf-8") as f:
        json.dump(fingerprint, f, ensure_ascii=False, indent=2)

    say("等待数据集新版本可挂载 ...")
    if not wait_marker(k, ref, marker):
        die("数据集 15 分钟内未就绪；稍后重跑会复用已上传内容，不会重复上传")
    say("数据集已就绪")
    return ref


def push_kernel(k, args, ref, user):
    kdir = os.path.join(BUILD, "kernel")
    os.makedirs(kdir, exist_ok=True)
    shutil.copy2(os.path.join(ROOT, NOTEBOOK), os.path.join(kdir, NOTEBOOK))

    meta = {
        "id": f"{user}/{args.kernel}",
        "title": args.kernel.replace("-", " ").replace("_", " ").title(),
        "code_file": NOTEBOOK,
        "language": "python",
        "kernel_type": "notebook",
        "is_private": True,
        "enable_gpu": True,
        "enable_tpu": False,
        "enable_internet": True,
        "dataset_sources": [ref],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    with open(os.path.join(kdir, "kernel-metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    say(f"推送 Notebook：{meta['id']}")
    cmd = ["kernels", "push", "-p", kdir, "--accelerator", args.accel]
    if args.no_run:
        cmd.append("--no-run")
    r = k(*cmd, timeout=600)
    if r.returncode != 0:
        blob = (r.stderr or "") + (r.stdout or "")
        hint = ""
        if "Maximum batch GPU session count" in blob:
            hint = ("\n有旧会话仍占着 GPU 名额：删掉卡住的旧版本后重试"
                    f"（kaggle kernels delete {meta['id']}）。")
        die("推送失败" + hint + "\n" + blob.strip())
    return meta["id"]


def wait_kernel(k, ref, timeout_s):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        r = k("kernels", "status", ref, quiet=True)
        m = re.search(r'"([^"]+)"', r.stdout or "")
        status = (m.group(1) if m else (r.stdout or "").strip()).rsplit(".", 1)[-1]
        if status != last:
            say(f"[{datetime.datetime.now():%H:%M:%S}] {status}")
            last = status
        if status in ("COMPLETE", "ERROR", "CANCEL_ACKNOWLEDGED", "CANCELED", "FAILED"):
            return status
        time.sleep(20)
    return "TIMEOUT"


def report(dest):
    path = os.path.join(dest, "summary.json")
    if not os.path.isfile(path):
        say("没有 summary.json，已下载的文件：")
        for name in sorted(os.listdir(dest)):
            say("  " + name)
        return
    summary = json.load(open(path, encoding="utf-8"))
    say("")
    say(f"音频：{os.path.basename(summary.get('audio', ''))}")
    for name, item in summary.get("variants", {}).items():
        probe = item.get("probe") or {}
        streams = probe.get("streams") or []
        video_stream = next((s for s in streams if s.get("codec_name") == "h264"), {})
        duration = (probe.get("format") or {}).get("duration")
        state = "成功" if item.get("ok") else "失败"
        say(f"- {name}: {state}  {video_stream.get('width')}x{video_stream.get('height')}  "
            f"{duration}s  {item.get('size_mb')}MB  推理 {item.get('elapsed_s')}s  "
            f"显存 {item.get('peak_vram_mb')}MB")
        say(f"  {os.path.join(dest, name, 'video_out.mp4')}")


def main():
    ap = argparse.ArgumentParser(
        description="LatentSync on Kaggle：自动识别账号、上传素材、推送并取回成片")
    ap.add_argument("--video", help="本地视频路径（默认取 inputs/ 里最新的）")
    ap.add_argument("--audio", help="本地音频路径（默认取 inputs/ 里最新的）")
    ap.add_argument("--dataset", help="数据集引用：slug 或 owner/slug；默认 <账号>/latentsync-inputs")
    ap.add_argument("--kernel", default="latentsync-dual", help="Notebook slug（默认 latentsync-dual）")
    ap.add_argument("--accel", default="NvidiaTeslaT4", help="加速器（默认 NvidiaTeslaT4 = GPU T4 x2）")
    ap.add_argument("--only", help="只跑指定变体：fullbody,closeup")
    ap.add_argument("--max-side", type=int, help="全身版长边上限（默认 1440）")
    ap.add_argument("--crop-pct", help="半身裁切比例：宽:高:左:上（默认 37:37:23:23）")
    ap.add_argument("--crop-px", help="半身裁切像素：宽:高:左:上（覆盖比例）")
    ap.add_argument("--crop-out", help="半身输出分辨率（默认 auto：高 1280）")
    ap.add_argument("--run-id", help="输出目录名（默认时间戳）")
    ap.add_argument("--output-dir", help="输出根目录（默认本模块 results/）")
    ap.add_argument("--json-out", help="额外写一份结果 JSON 清单")
    ap.add_argument("--no-run", action="store_true", help="只保存版本不运行（Quick Save）")
    ap.add_argument("--no-wait", action="store_true", help="推送后立即返回，不等待、不下载")
    ap.add_argument("--timeout", type=int, default=120, help="等待运行的分钟数（默认 120）")
    ap.add_argument("--force-upload", action="store_true", help="素材没变也重新上传数据集")
    ap.add_argument("--kaggle", help='kaggle 命令，例如 "uv tool run kaggle"（默认自动探测）')
    args = ap.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    k = K(kaggle_bin(args.kaggle))
    user = resolve_username(k)
    video = pick_file(args.video, VIDEO_EXT, "视频", "video")
    audio = pick_file(args.audio, AUDIO_EXT, "音频", "audio")

    say(f"账号：{user}")
    say(f"视频：{video}")
    say(f"音频：{audio}")

    if args.dataset:
        ref = args.dataset if "/" in args.dataset else f"{user}/{args.dataset}"
    else:
        ref = f"{user}/latentsync-inputs"

    prepare_dataset(k, args, ref, video, audio)
    kernel = push_kernel(k, args, ref, user)
    url = f"https://www.kaggle.com/code/{kernel}"
    say("任务页：" + url)

    if args.no_run:
        say("已保存新版本（未运行）。去掉 --no-run 即可真正开跑。")
        return
    if args.no_wait:
        say("已提交，未等待。之后查看：kaggle kernels status " + kernel)
        return

    say("等待运行（首次含装依赖和下载权重，约 40–55 分钟）...")
    status = wait_kernel(k, kernel, args.timeout * 60)
    run_id = args.run_id or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(os.path.abspath(args.output_dir) if args.output_dir else RESULTS, run_id)
    os.makedirs(dest, exist_ok=True)

    if status != "COMPLETE":
        say(f"运行结束状态：{status}，下载日志定位 ...")
        k("kernels", "output", kernel, "-p", dest, quiet=True)
        for name in os.listdir(dest):
            if name.endswith(".log"):
                lines = open(os.path.join(dest, name), encoding="utf-8",
                             errors="replace").read().splitlines()
                say(f"--- {name} 末尾 40 行 ---")
                say("\n".join(lines[-40:]))
        die(f"运行未成功（{status}）。文件在 {dest}", 2)

    say("下载成片 ...")
    r = k("kernels", "output", kernel, "-p", dest, quiet=True)
    if r.returncode != 0:
        die("下载失败：" + (r.stderr or r.stdout or "").strip())
    report(dest)
    if args.json_out:
        summary_path = os.path.join(dest, "summary.json")
        payload = {}
        if os.path.isfile(summary_path):
            with open(summary_path, encoding="utf-8") as fh:
                payload = json.load(fh)
        payload["output_dir"] = dest
        payload["kernel_url"] = url
        payload["kernel"] = kernel
        with open(os.path.abspath(args.json_out), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
    say("")
    say(f"输出目录：{dest}")


if __name__ == "__main__":
    main()
