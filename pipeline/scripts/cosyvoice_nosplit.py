"""Synthesize one continuous take: the whole text goes to the model in one piece.

CosyVoice's inference_zero_shot() splits text at punctuation into 60-80 token
pieces and concatenates them without a crossfade, which leaves audible splices.
This driver keeps the engine's own loading path but calls the frontend/model
once, so a long script comes back as a single continuous utterance.

CLI: python cosyvoice_nosplit.py --text-file script.txt --out take.wav \
        --ref 0226_prompt.wav --ref-text 0226_prompt.txt [--speed 1.0] [--seed 2026]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BACKEND = Path(os.environ.get("OD_VOICESTUDIO_BACKEND") or ROOT / "vendor" / "VoiceStudio" / "backend")
SIDECAR_DIR = BACKEND / "engines" / "cosyvoice_subprocess"
CHECKOUT = Path(os.environ.get("OD_COSYVOICE_VENDOR") or ROOT / "vendor" / "CosyVoice")
MODEL_DIR = Path(os.environ.get("OD_COSYVOICE3_MODEL") or ROOT / "models" / "Fun-CosyVoice3-0.5B")
SAMPLE_RATE = 24_000


class _Sink:
    fmt = 1

    def write(self, *_args, **_kwargs):
        return 0

    def flush(self):
        pass


def load_engine():
    os.environ.setdefault("OMNIVOICE_COSYVOICE_DIR", str(CHECKOUT))
    os.environ.setdefault("OMNIVOICE_COSYVOICE_MODEL", str(MODEL_DIR))
    for path in (str(SIDECAR_DIR), str(CHECKOUT), str(CHECKOUT / "third_party" / "Matcha-TTS")):
        if path not in sys.path:
            sys.path.insert(0, path)
    import main as sidecar  # noqa: PLC0415 - vendor sidecar module

    model = sidecar._load_model(_Sink())
    return sidecar, model


def _pieces(text: str, limit: int):
    """Split on sentence ends and pack groups that the model handles reliably."""
    import re

    if limit <= 0 or len(text) <= limit:
        return [text]
    sents = [s for s in re.split(r"(?<=[。！？；!?;])", text) if s.strip()]
    if not sents:
        return [text]
    groups, cur = [], ""
    for s in sents:
        if cur and len(cur) + len(s) > limit:
            groups.append(cur)
            cur = s
        else:
            cur += s
    if cur:
        groups.append(cur)
    return groups


def _synth(model, sidecar, v3, text: str, prompt_text: str, prompt_wav: str, speed: float, seed):
    import torch  # noqa: PLC0415

    if seed is not None:
        torch.manual_seed(int(seed))
    # The v3 system prompt belongs to the reference side only. Putting it in
    # front of the target text makes the model speak the prompt itself (a
    # short foreign-language blip at every chunk start) and skip words.
    tts_text = model.frontend.text_normalize(text, split=False)
    model_input = model.frontend.frontend_zero_shot(
        tts_text, prompt_text, prompt_wav, model.sample_rate, ""
    )
    pieces = [
        torch.as_tensor(o["tts_speech"], dtype=torch.float32).reshape(-1)
        for o in model.model.tts(**model_input, stream=False, speed=float(speed))
    ]
    return torch.cat(pieces).clamp(-1.0, 1.0) if pieces else None


def _trim(x, sr: int, floor_db: float = -45.0, pre: float = 0.02, tail: float = 0.06):
    """Keep the utterance, drop the model's padded silence so joins stay clean."""
    import torch  # noqa: PLC0415

    thr = 10 ** (floor_db / 20.0)
    loud = torch.nonzero(x.abs() > thr).flatten()
    if loud.numel() == 0:
        return x
    a = max(0, int(loud[0].item()) - int(pre * sr))
    b = min(x.numel(), int(loud[-1].item()) + int(tail * sr))
    return x[a:b]


def _level(x, ref_db: float, cap_db: float = 2.5):
    import torch  # noqa: PLC0415

    rms = float(x.pow(2).mean().sqrt().clamp(min=1e-9))
    cur = 20.0 * float(torch.log10(torch.tensor(rms)))
    gain_db = max(-cap_db, min(cap_db, ref_db - cur))
    return x * (10.0 ** (gain_db / 20.0))


def _xfade(acc, nxt, sr: int, xf: float = 0.05):
    """Equal-power crossfade: the join rides through near-silence, no click."""
    import torch  # noqa: PLC0415

    f = int(xf * sr)
    if acc.numel() < f or nxt.numel() < f:
        return torch.cat([acc, nxt])
    t = torch.linspace(0.0, 1.0, f)
    out = acc.clone()
    out[-f:] = acc[-f:] * torch.cos(t * torch.pi / 2) + nxt[:f] * torch.sin(t * torch.pi / 2)
    return torch.cat([out, nxt[f:]])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--ref-text-file", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--chunk-chars", type=int, default=150)
    ap.add_argument("--xfade", type=float, default=0.05)
    ap.add_argument("--dump-dir", default="")
    args = ap.parse_args()

    import re

    text = re.sub(r"\s+", "", Path(args.text_file).read_text(encoding="utf-8"))
    ref_text = Path(args.ref_text_file).read_text(encoding="utf-8").strip()
    out = Path(args.out)

    sidecar, model = load_engine()
    v3 = sidecar._is_v3(model)

    import torch  # noqa: PLC0415
    import soundfile as sf  # noqa: PLC0415

    prompt_wav = str(Path(args.ref).resolve())
    prompt_text = model.frontend.text_normalize(ref_text, split=False)
    prompt_text = sidecar._v3_prompt(prompt_text) if v3 else prompt_text

    groups = _pieces(text, int(args.chunk_chars))
    takes = []
    for i, group in enumerate(groups):
        wav = _synth(model, sidecar, v3, group, prompt_text, prompt_wav, args.speed, args.seed)
        if wav is None:
            print(json.dumps({"ok": False, "error": f"no audio for chunk {i}"}))
            return 1
        takes.append(_trim(wav, model.sample_rate))
        if args.dump_dir:
            dump = Path(args.dump_dir)
            dump.mkdir(parents=True, exist_ok=True)
            sf.write(str(dump / f"chunk{i:02d}.wav"), wav.numpy(), int(model.sample_rate))
            (dump / f"chunk{i:02d}.txt").write_text(group, encoding="utf-8")
        print(json.dumps({"chunk": i, "chars": len(group), "seconds": round(wav.numel() / model.sample_rate, 2)}), flush=True)

    sr = int(model.sample_rate)
    if len(takes) > 1:
        rms = [float(t.pow(2).mean().sqrt()) for t in takes]
        ref_db = 20.0 * float(torch.log10(torch.tensor(sorted(rms)[len(rms) // 2]).clamp(min=1e-9)))
        takes = [_level(t, ref_db) for t in takes]
    acc = takes[0]
    for nxt in takes[1:]:
        acc = _xfade(acc, nxt, sr, float(args.xfade))

    wav = acc.clamp(-1.0, 1.0)
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), wav.numpy(), sr)
    print(json.dumps({"ok": True, "out": str(out), "seconds": round(wav.numel() / sr, 2), "chunks": len(takes)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
