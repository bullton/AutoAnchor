"""Local CosyVoice 3 driver: speaks the VoiceStudio sidecar protocol directly.

Runs the engine's own sidecar script as a child process (same code path the
service uses: fp32 Qwen2 repair, 24 kHz PCM) without an HTTP server. One child
is loaded per run, so the model loads once and every chunk is synthesized from
the same resident weights.

CLI:  python cosyvoice3_worker.py --selftest "文案" out.wav
Library: LocalCosyVoice(...).synthesize(text, speed=1.0, seed=None, instruct="")
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAX_FRAME_BYTES = 64 * 1024 * 1024
SAMPLE_RATE = 24_000

ROOT = HERE.parents[1]
VENV_BIN = "Scripts" if os.name == "nt" else "bin"
PYTHON_EXE = "python.exe" if os.name == "nt" else "python"
DEFAULT_PYTHON = Path(os.environ.get("OD_COSYVOICE_PYTHON") or ROOT / "vendor" / "CosyVoice" / ".venv" / VENV_BIN / PYTHON_EXE)
BACKEND_DIR = Path(os.environ.get("OD_VOICESTUDIO_BACKEND") or ROOT / "vendor" / "VoiceStudio" / "backend")
DEFAULT_SIDECAR = BACKEND_DIR / "engines" / "cosyvoice_subprocess" / "main.py"
DEFAULT_CHECKOUT = Path(os.environ.get("OD_COSYVOICE_VENDOR") or ROOT / "vendor" / "CosyVoice")
DEFAULT_MODEL = Path(os.environ.get("OD_COSYVOICE3_MODEL") or ROOT / "models" / "Fun-CosyVoice3-0.5B")


def _read_exact(stream, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            raise IOError("sidecar closed the pipe")
        buf.extend(chunk)
    return bytes(buf)


def postprocess(pcm: bytes, watermark: bool = True) -> bytes:
    """Apply the service's own speech finishing chain so local output matches.

    Mirrors openai_compat._run_tts: trim edge silence, highpass + gentle
    compression, peak-normalise to -2 dBFS, then (optionally) AudioSeal.
    Any missing dependency degrades to peak normalisation only.
    """
    import numpy as np

    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if audio.size == 0:
        return pcm
    peak = float(np.abs(audio).max())
    if peak <= 10 ** (-50.0 / 20.0):
        return pcm
    try:
        import torch

        if str(BACKEND_DIR) not in sys.path:
            sys.path.insert(0, str(BACKEND_DIR))
        from services.audio_dsp import (
            apply_mastering,
            normalize_audio,
            trim_speech_padding,
        )

        wav = torch.from_numpy(audio.copy())
        wav = trim_speech_padding(wav, SAMPLE_RATE)
        wav = apply_mastering(wav, sample_rate=SAMPLE_RATE)
        wav = normalize_audio(wav, target_dBFS=-2.0)
        if watermark:
            try:
                from services.watermark import mark_synthetic

                wav = mark_synthetic(wav, SAMPLE_RATE, context="pipeline.local3")
            except Exception:
                pass
        audio = wav.detach().cpu().numpy().astype(np.float32)
    except Exception:
        audio = audio * ((10 ** (-2.0 / 20.0)) / peak)
    audio = np.clip(audio, -1.0, 1.0)
    return (audio * 32767.0).astype(np.int16).tobytes()


class LocalCosyVoice:
    def __init__(
        self,
        python: Path = DEFAULT_PYTHON,
        sidecar: Path = DEFAULT_SIDECAR,
        checkout: Path = DEFAULT_CHECKOUT,
        model_dir: Path = DEFAULT_MODEL,
        log_path: Path | None = None,
    ) -> None:
        env = dict(os.environ)
        env.update(
            {
                "OMNIVOICE_COSYVOICE_DIR": str(checkout),
                "OMNIVOICE_COSYVOICE_MODEL": str(model_dir),
                "PYTHONPATH": os.pathsep.join(
                    [str(checkout), str(checkout / "third_party" / "Matcha-TTS")]
                ),
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
            }
        )
        log = open(log_path, "ab") if log_path else subprocess.DEVNULL
        self._log = log
        self.proc = subprocess.Popen(
            [str(python), str(sidecar)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log,
            env=env,
            bufsize=0,
        )
        try:
            first = self._recv()
        except Exception:
            self.close()
            raise
        if not first or first.get("op") != "ready":
            self.close()
            raise RuntimeError(f"sidecar 未就绪：{first}")

    # -- framing ----------------------------------------------------------
    def _send(self, obj: dict) -> None:
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.proc.stdin.write(struct.pack("!I", len(body)))
        self.proc.stdin.write(body)
        self.proc.stdin.flush()

    def _recv(self) -> dict:
        header = _read_exact(self.proc.stdout, 4)
        (n,) = struct.unpack("!I", header)
        if n > MAX_FRAME_BYTES:
            raise IOError(f"frame too large: {n}")
        return json.loads(_read_exact(self.proc.stdout, n).decode("utf-8"))

    # -- API --------------------------------------------------------------
    def synthesize(
        self,
        text: str,
        ref_audio: str | None = None,
        ref_text: str | None = None,
        speed: float = 1.0,
        seed: int | None = None,
        instruct: str | None = None,
        mastering: bool = True,
        watermark: bool = True,
    ) -> bytes:
        msg = {"op": "synthesize", "text": text, "speed": float(speed)}
        if ref_audio:
            msg["ref_audio"] = str(ref_audio)
        if ref_text:
            msg["ref_text"] = ref_text
        if seed is not None:
            msg["seed"] = int(seed)
        if instruct:
            msg["instruct"] = instruct
        self._send(msg)
        while True:
            frame = self._recv()
            op = frame.get("op")
            if op == "audio":
                pcm = base64.b64decode(frame["audio_pcm_b64"])
                if int(frame.get("sample_rate") or SAMPLE_RATE) != SAMPLE_RATE:
                    raise RuntimeError("unexpected sample rate from sidecar")
                if mastering:
                    return postprocess(pcm, watermark=watermark)
                return pcm
            if op == "error":
                raise RuntimeError(
                    frame.get("message") or frame.get("detail") or "sidecar error"
                )
            # progress / heartbeat frames are informational

    def close(self) -> None:
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()
        if self._log is not subprocess.DEVNULL:
            try:
                self._log.close()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- helper -----------------------------------------------------------
    @staticmethod
    def write_wav(pcm: bytes, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm)
        return path


def main() -> int:
    ap = argparse.ArgumentParser(description="Local CosyVoice 3 synthesis")
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref", default=None)
    ap.add_argument("--ref-text", default=None)
    ap.add_argument("--ref-text-file", default=None)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--instruct", default=None)
    ap.add_argument("--log", default=None)
    args = ap.parse_args()

    ref_text = args.ref_text
    if not ref_text and args.ref_text_file:
        ref_text = Path(args.ref_text_file).read_text(encoding="utf-8").strip()

    with LocalCosyVoice(log_path=Path(args.log) if args.log else None) as engine:
        pcm = engine.synthesize(
            args.text,
            ref_audio=args.ref,
            ref_text=ref_text,
            speed=args.speed,
            seed=args.seed,
            instruct=args.instruct,
        )
    LocalCosyVoice.write_wav(pcm, Path(args.out))
    print(json.dumps({"ok": True, "out": args.out, "seconds": round(len(pcm) / 2 / SAMPLE_RATE, 2)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
