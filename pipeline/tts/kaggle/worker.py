"""IndexTTS-2.5 worker (batch): synthesize every request.segments item.

Runs inside the cloned index-tts venv on a Kaggle GPU kernel.
Output layout (under /kaggle/working):

  output/<job_id>/segments/<id>.wav
  output/<job_id>/audio.wav        # all segments joined with a small gap
  output/<job_id>/manifest.json    # per-segment durations for the local timeline
  output/<job_id>/result.json

The request may still contain a single `text` (legacy); in that case it is
treated as one segment.
"""

import glob
import json
import os
import sys
import time
import traceback
from pathlib import Path

WORK_ROOT = Path("/kaggle/working")
OUTPUT_ROOT = WORK_ROOT / "output"
GAP_SECONDS = 0.2


def log(message):
    print(f"[indextts:worker] {message}", flush=True)


def write_result(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("RESULT_JSON " + json.dumps(payload, ensure_ascii=False), flush=True)


def resolve_input(raw, label):
    if not raw:
        return None
    path = Path(raw)
    if path.is_file():
        return str(path.resolve())

    name = path.name
    patterns = []
    parts = path.parts
    if "input" in parts:
        tail = parts[parts.index("input") + 1:]
        if len(tail) >= 2:
            slug = tail[0]
            rest = "/".join(tail[1:])
            patterns.append(f"/kaggle/input/datasets/*/{slug}/{rest}")
            patterns.append(f"/kaggle/input/{slug}/{rest}")
    patterns.append(f"/kaggle/input/datasets/*/*/{name}")
    patterns.append(f"/kaggle/input/*/{name}")

    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if matches:
            return str(Path(matches[0]).resolve())
    raise FileNotFoundError(f"{label} not found: {raw}")


def rel_to_work(path):
    try:
        return str(Path(path).relative_to(WORK_ROOT))
    except ValueError:
        return str(path)


def audio_metadata(path):
    try:
        import soundfile as sf

        info = sf.info(path)
        return {
            "duration_sec": round(float(info.duration), 3),
            "sample_rate": int(info.samplerate),
            "channels": int(info.channels),
        }
    except Exception:
        return {}


def request_segments(request):
    raw = request.get("segments")
    if isinstance(raw, list) and raw:
        segments = []
        for index, item in enumerate(raw, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"segments[{index}] must be an object")
            text = (item.get("text") or "").strip()
            if not text:
                raise ValueError(f"segments[{index}].text is empty")
            segments.append(
                {"id": str(item.get("id") or f"seg{index:02d}"), "text": text}
            )
        return segments
    text = (request.get("text") or "").strip()
    if not text:
        raise ValueError("request has neither segments nor text")
    return [{"id": "audio", "text": text}]


def main():
    request_path = Path(os.environ["INDEXTTS_REQUEST_PATH"])
    result_path = Path(os.environ["INDEXTTS_RESULT_PATH"])
    job_id = os.environ.get("INDEXTTS_JOB_ID", "unknown")
    output_path = Path(os.environ["INDEXTTS_OUTPUT_PATH"])
    model_dir = Path(os.environ["INDEXTTS_MODEL_DIR"])
    started = time.time()

    request = json.loads(request_path.read_text(encoding="utf-8"))
    segments = request_segments(request)
    voice_path = resolve_input(request.get("voice_path"), "voice reference")
    emo_audio_path = resolve_input(request.get("emo_audio_path"), "emotion reference")

    output_dir = output_path.parent
    segment_dir = output_dir / "segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"

    os.chdir(os.environ.get("INDEXTTS_CLONE_DIR", "/tmp/indextts-work/index-tts"))
    sys.path.insert(0, os.getcwd())
    sys.path.insert(0, os.environ.get("INDEXTTS_CLONE_DIR", os.getcwd()))

    import torch
    from indextts.infer_v2_5 import IndexTTS2

    log(f"torch {torch.__version__}; cuda={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        log(f"gpu {torch.cuda.get_device_name(0)}")

    tts = IndexTTS2(
        cfg_path=str(model_dir / "config.yaml"),
        model_dir=str(model_dir),
        use_bf16=bool(request.get("use_bf16", False)),
        use_cuda_kernel=False,
        use_deepspeed=False,
        use_torch_compile=False,
        use_qwen_emo=bool(request.get("use_qwen_emo", False)),
    )

    lang = request.get("lang") or "ZH"
    duration_factor = float(request.get("duration_factor") or 1.0)
    interval_silence = int(request.get("interval_silence") or 200)
    max_tokens = int(request.get("max_text_tokens_per_segment") or 120)

    manifest = []
    for index, segment in enumerate(segments, start=1):
        target = segment_dir / f"{segment['id']}.wav"
        log(f"[{index}/{len(segments)}] {segment['id']}: {segment['text'][:32]}")
        if not (target.is_file() and target.stat().st_size > 10000):
            infer_kwargs = {
                "spk_audio_prompt": voice_path,
                "text": segment["text"],
                "output_path": str(target),
                "lang": lang,
                "verbose": True,
                "max_text_tokens_per_segment": max_tokens,
                "interval_silence": interval_silence,
                "duration_factor": duration_factor,
            }
            if emo_audio_path:
                infer_kwargs["emo_audio_prompt"] = emo_audio_path
                infer_kwargs["emo_alpha"] = float(request.get("emo_alpha", 1.0))
            tts.infer(**infer_kwargs)
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError(f"inference finished without producing {target}")

        meta = audio_metadata(str(target))
        manifest.append(
            {
                "id": segment["id"],
                "text": segment["text"],
                "file": rel_to_work(target),
                "bytes": target.stat().st_size,
                **meta,
            }
        )

    joined = None
    sample_rate = None
    try:
        import numpy as np
        import soundfile as sf

        frames = []
        for index, item in enumerate(manifest):
            data, rate = sf.read(str(WORK_ROOT / item["file"]), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            if sample_rate is None:
                sample_rate = int(rate)
            if int(rate) != sample_rate:
                raise RuntimeError(f"sample rate mismatch: {rate} != {sample_rate}")
            frames.append(data)
            if index != len(manifest) - 1 and GAP_SECONDS > 0:
                frames.append(np.zeros(int(sample_rate * GAP_SECONDS), dtype=np.float32))
        joined = np.concatenate(frames) if frames else np.zeros(1, dtype=np.float32)
        sf.write(str(output_path), joined, sample_rate, subtype="PCM_16")
    except Exception as exc:
        log(f"could not build combined audio: {exc!r}")

    total_seconds = (
        round(float(len(joined)) / sample_rate, 3)
        if joined is not None and sample_rate
        else None
    )
    if total_seconds is None:
        total_seconds = round(
            sum(float(item.get("duration_sec") or 0.0) for item in manifest), 3
        )

    manifest_payload = {
        "job_id": job_id,
        "voice_path": voice_path,
        "lang": lang,
        "duration_factor": duration_factor,
        "sample_rate": sample_rate,
        "total_duration_sec": total_seconds,
        "segments": manifest,
        "elapsed_sec": round(time.time() - started, 2),
    }
    manifest_path.write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    audio_file = rel_to_work(output_path)

    result = {
        "status": "ok",
        "job_id": job_id,
        "audio_path": str(output_path),
        "audio_file": audio_file,
        "audio_bytes": output_path.stat().st_size if output_path.is_file() else 0,
        "manifest_file": rel_to_work(manifest_path),
        "segment_count": len(manifest),
        "duration_sec": total_seconds,
        "sample_rate": sample_rate,
        "voice_path": voice_path,
        "model_dir": str(model_dir),
        "elapsed_sec": round(time.time() - started, 2),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }
    write_result(result_path, result)
    log(f"done in {result['elapsed_sec']}s -> {output_dir}")


if __name__ == "__main__":
    request_file = Path(os.environ["INDEXTTS_REQUEST_PATH"])
    result_file = Path(os.environ["INDEXTTS_RESULT_PATH"])
    job = os.environ.get("INDEXTTS_JOB_ID", "unknown")
    started_at = time.time()
    try:
        main()
    except Exception as exc:
        traceback.print_exc()
        payload = {
            "status": "error",
            "stage": "inference",
            "job_id": job,
            "error": repr(exc),
            "traceback": traceback.format_exc(),
            "elapsed_sec": round(time.time() - started_at, 2),
            "request_path": str(request_file),
        }
        try:
            write_result(result_file, payload)
        except Exception:
            fallback = OUTPUT_ROOT / job / "result.json"
            write_result(fallback, payload)
        sys.exit(1)
