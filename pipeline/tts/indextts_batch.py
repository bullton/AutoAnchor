"""在 IndexTTS 自带环境中批量合成（由 02_tts.py 调用）。

用法（在 IndexTTS 仓库目录下运行）：
  .venv\\Scripts\\python.exe <项目根>\\pipeline\\tts\\indextts_batch.py --jobs jobs.json --prompt ref.wav
"""

import argparse
import json
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True, help="JSON: [{id, text, out}]")
    ap.add_argument("--model-dir", default="checkpoints")
    ap.add_argument("--prompt", required=True, help="参考音色 wav")
    ap.add_argument("--lang", default="ZH")
    ap.add_argument("--device", default=None)
    ap.add_argument("--fp32", action="store_true")
    ap.add_argument("--qwen-emo", action="store_true")
    args = ap.parse_args()

    with open(args.jobs, "r", encoding="utf-8") as f:
        jobs = json.load(f)

    from indextts.infer_v2_5 import IndexTTS2

    print(f">> 加载 IndexTTS2：{os.path.abspath(args.model_dir)}", flush=True)
    tts = IndexTTS2(
        cfg_path=os.path.join(args.model_dir, "config.yaml"),
        model_dir=args.model_dir,
        use_bf16=not args.fp32,
        device=args.device if args.device else None,
        use_cuda_kernel=False,
        use_deepspeed=False,
        use_qwen_emo=args.qwen_emo,
    )

    for i, job in enumerate(jobs, start=1):
        out = job["out"]
        if os.path.isfile(out) and os.path.getsize(out) > 10000:
            print(f">> [{i}/{len(jobs)}] 跳过已存在：{job['id']}", flush=True)
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        print(f">> [{i}/{len(jobs)}] 合成 {job['id']}：{job['text'][:28]}", flush=True)
        tts.infer(
            spk_audio_prompt=args.prompt,
            text=job["text"],
            output_path=out,
            lang=args.lang,
            verbose=True,
        )

    print(f"INDEXTTS_DONE {len(jobs)}", flush=True)


if __name__ == "__main__":
    main()
