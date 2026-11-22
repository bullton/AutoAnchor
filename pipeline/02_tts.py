"""逐句合成配音，输出 voice.wav 与 timeline.json。

provider:
  indextts   本地 IndexTTS-2.5（默认，逐句合成，4GB 显存可跑）
  kaggle     在 Kaggle GPU 上批量跑 IndexTTS-2.5（需 kaggle CLI + 凭据）
  cosyvoice  本地 CosyVoice（备选，需先运行 scripts/setup-cosyvoice.ps1）
  voicestudio 本机 VoiceStudio 服务（CosyVoice3/OmniVoice，逐段稳速）
  edge       微软 Edge-TTS（临时代替，免费无需 Key）
"""

import argparse
import asyncio
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_ROOT = Path(os.environ.get("OD_OUTPUT_DIR") or (ROOT / "output"))
if not OUT_ROOT.is_absolute():
    OUT_ROOT = ROOT / OUT_ROOT


def default_path(env_name, *parts):
    value = os.environ.get(env_name)
    return Path(value) if value else ROOT.joinpath(*parts)


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode != 0:
        raise RuntimeError(f"命令失败: {' '.join(map(str, cmd))}\n{p.stderr[-2000:]}")
    return p


def probe_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    )
    return float(p.stdout.strip())


def spoken_units(text: str) -> float:
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    digits = len(re.findall(r"\d", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    percent = text.count("%") * 2
    return cn + digits * 0.6 + latin * 0.8 + percent


CN_DIGITS = "零一二三四五六七八九"


def _int_cn(n: int) -> str:
    if n < 10:
        return CN_DIGITS[n]
    if n < 20:
        return "十" + (CN_DIGITS[n % 10] if n % 10 else "")
    if n < 100:
        return CN_DIGITS[n // 10] + "十" + (CN_DIGITS[n % 10] if n % 10 else "")
    if n < 1000:
        head = CN_DIGITS[n // 100] + "百"
        rest = n % 100
        if rest == 0:
            return head
        return head + ("零" + _int_cn(rest) if rest < 10 else _int_cn(rest))
    if n < 10000:
        head = CN_DIGITS[n // 1000] + "千"
        rest = n % 1000
        if rest == 0:
            return head
        return head + ("零" + _int_cn(rest) if rest < 100 else _int_cn(rest))
    head = _int_cn(n // 10000) + "万"
    rest = n % 10000
    if rest == 0:
        return head
    return head + ("零" + _int_cn(rest) if rest < 1000 else _int_cn(rest))


def _num_cn(value: str) -> str:
    if "." in value:
        whole, frac = value.split(".", 1)
        return _int_cn(int(whole)) + "点" + "".join(CN_DIGITS[int(c)] for c in frac)
    return _int_cn(int(value))


def normalize_tts_text(text: str) -> str:
    text = re.sub(r"(\d{2,4})(?=\s*年)", lambda m: "".join(CN_DIGITS[int(c)] for c in m.group(1)), text)
    text = re.sub(r"(\d+(?:\.\d+)?)%", lambda m: "百分之" + _num_cn(m.group(1)), text)
    text = re.sub(r"(\d+)\.(\d+)", lambda m: _int_cn(int(m.group(1))) + "点"
                  + "".join(CN_DIGITS[int(c)] for c in m.group(2)), text)
    text = re.sub(r"\d+", lambda m: _int_cn(int(m.group(0))), text)
    return text


def normalize(src: Path, dst: Path, speak_rate: float = 1.0) -> None:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if abs(speak_rate - 1.0) > 1e-4:
        cmd += ["-af", f"atempo={speak_rate:.4f}"]
    cmd += ["-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)]
    run(cmd)


def tighten_gaps(src: Path, dst: Path) -> None:
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(src, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    win = max(1, int(sr * 0.01))
    n = len(data) // win
    frames = data[: n * win].reshape(n, win)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    db = 20 * np.log10(np.maximum(rms, 1e-8))
    voiced = db > -44.0

    runs = []
    i = 0
    while i < n:
        if not voiced[i]:
            j = i
            while j < n and not voiced[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1

    pieces = []
    cursor = 0
    for start, end in runs:
        if start == 0 or end == n:
            continue
        dur = (end - start) * 0.01
        if dur < 0.05:
            continue
        if dur < 0.13:
            target = 0.120
        elif dur < 0.28:
            target = 0.180
        elif dur < 0.60:
            target = 0.220
        else:
            target = 0.260
        keep = max(1, int(round(target / 0.01)))
        run_len = end - start
        if keep >= run_len - 1:
            if keep - run_len >= 3:
                pieces.append(data[cursor * win:start * win])
                pieces.append(_room_tone(keep * 0.01 - dur, sr))
                cursor = end
            continue
        left = (end - start - keep) // 2
        cut_start = start + left
        cut_end = cut_start + keep
        pieces.append(data[cursor * win: cut_start * win])
        cursor = cut_end
    pieces.append(data[cursor * win:])
    out = np.concatenate(pieces) if pieces else data
    sf.write(str(dst), out, sr, subtype="PCM_16")


ROOM_TONE_AMP = 0.0007


def _room_tone(seconds: float, sr: int):
    """Low-level noise bed so joins never fall into digital silence."""
    import numpy as np

    n = max(0, int(round(seconds * sr)))
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    rng = np.random.default_rng(20261116 + n)
    bed = rng.normal(0.0, 1.0, n).astype(np.float32)
    bed = np.convolve(bed, np.ones(12, dtype=np.float32) / 12.0, mode="same").astype(np.float32)
    peak = float(np.max(np.abs(bed))) or 1.0
    return (bed / peak * ROOM_TONE_AMP).astype(np.float32)


def pad(src: Path, dst: Path, gap: float, lead: float = 0.0) -> None:
    """Keep the natural tail, fade edges, and fill the pause with room tone."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(src, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    lead = max(lead, 0.06)
    if data.size == 0:
        sf.write(str(dst), np.zeros(int((lead + gap) * sr), dtype=np.float32), sr, subtype="PCM_16")
        return

    win = max(1, int(sr * 0.01))
    nf = data.size // win
    rms = np.sqrt((data[: nf * win].reshape(nf, win) ** 2).mean(axis=1))
    voiced = np.flatnonzero(rms > 10 ** (-58 / 20))
    if voiced.size:
        start = max(0, int(voiced[0] * win - 0.03 * sr))
        end = min(data.size, int((voiced[-1] + 1) * win + 0.06 * sr))
        data = data[start:end]

    fade = max(1, int(0.012 * sr))
    if data.size > 2 * fade:
        data = data.copy()
        data[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
        data[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)

    out = np.concatenate([
        _room_tone(lead, sr),
        data.astype(np.float32),
        _room_tone(gap, sr),
    ])
    sf.write(str(dst), out, sr, subtype="PCM_16")


def pad_append(src: Path, dst: Path, gap: float, lead: float = 0.0) -> None:
    """Join a take to the pause with matching edges, so no splice can click."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(src, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    data = data.astype(np.float32)

    head_len = int(max(lead, 0.0) * sr)
    tail_len = int(max(gap, 0.0) * sr)

    # The take keeps its own natural silence; only the outer edges are shaped so
    # the join is continuous in level (no step into or out of the pause).
    fade_in = max(1, int(0.015 * sr))
    fade_out = max(1, int(0.020 * sr))
    if data.size > fade_in + fade_out:
        data = data.copy()
        data[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
        data[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)

    floor = 0.0
    floor = min(max(floor, 0.0), 0.0)

    def bed(n: int) -> np.ndarray:
        return np.zeros(max(0, n), dtype=np.float32)

    out = np.concatenate([bed(head_len), data, bed(tail_len)])
    sf.write(str(dst), out, sr, subtype="PCM_16")


def match_page_levels(items, voice_path: Path, max_cut_db: float = 6.0) -> None:
    """Even out loudness across pages so joins don't jump like a switch."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(str(voice_path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    levels = []
    for it in items:
        a, b = int(it["start"] * sr), int(it["end"] * sr)
        seg = data[a:b]
        loud = np.abs(seg) > 0.01
        if not loud.any():
            levels.append(None)
            continue
        first = int(np.flatnonzero(loud)[0])
        active = seg[first:]
        levels.append(20 * np.log10(max(float(np.sqrt((active ** 2).mean())), 1e-9)))
    vals = [v for v in levels if v is not None]
    if len(vals) < 2:
        return
    target = float(np.percentile(vals, 25))

    out = data.copy()
    ramp = max(1, int(0.05 * sr))
    for it, lv in zip(items, levels):
        if lv is None:
            continue
        gain_db = min(0.0, max(-max_cut_db, target - lv))
        if abs(gain_db) < 0.2:
            continue
        a, b = int(it["start"] * sr), int(it["end"] * sr)
        seg = out[a:b] * (10 ** (gain_db / 20.0))
        r = min(ramp, seg.size // 2)
        if r > 1:
            seg[:r] *= np.linspace(0.0, 1.0, r, dtype=np.float32)
            seg[-r:] *= np.linspace(1.0, 0.0, r, dtype=np.float32)
        out[a:b] = seg

    sf.write(str(voice_path), out, sr, subtype="PCM_16")


def synth_edge(texts, outs, cfg):
    import edge_tts

    voice = cfg.get("voice", "zh-CN-XiaoxiaoNeural")
    rate = cfg.get("rate", "+0%")

    async def _all():
        for text, out in zip(texts, outs):
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            await communicate.save(str(out))

    asyncio.run(_all())


def synth_cosyvoice(texts, outs, cfg):
    sys.path.insert(0, str(HERE / "tts"))
    from cosyvoice_synth import CosyVoiceEngine

    engine = CosyVoiceEngine(cfg)
    engine.synthesize(texts, outs)


VS_PROFILE_CACHE = HERE / "tts" / "voicestudio_profiles.json"


def _vs_read_json(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _vs_post_json(url, payload, timeout=1800):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _vs_post_form(url, fields, timeout=1800):
    import uuid

    boundary = uuid.uuid4().hex
    body = bytearray()
    for key, value in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += str(value).encode("utf-8") + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=bytes(body), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _vs_healthy(base: str) -> bool:
    try:
        with urllib.request.urlopen(base + "/health", timeout=4) as resp:
            return resp.status == 200
    except Exception:
        return False


def _vs_profile_exists(base: str, profile_id: str) -> bool:
    try:
        _vs_read_json(f"{base}/profiles/{profile_id}", timeout=10)
        return True
    except urllib.error.HTTPError as err:
        return err.code != 404
    except Exception:
        return False


def _vs_create_profile(base: str, ref: Path, ref_text: str):
    import uuid

    boundary = "----vs" + uuid.uuid4().hex
    body = bytearray()

    def field(name: str, value: str):
        body.extend(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n".encode("utf-8")
        )

    cjk = bool(re.search(r"[\u4e00-\u9fff]", ref_text or ref.name))
    field("name", ref.stem)
    field("ref_text", ref_text or "")
    field("language", "Chinese" if cjk else "English")
    mime = mimetypes.guess_type(ref.name)[0] or "application/octet-stream"
    body.extend(
        f'--{boundary}\r\nContent-Disposition: form-data; name="ref_audio"; '
        f'filename="{ref.name}"\r\nContent-Type: {mime}\r\n\r\n'.encode("utf-8")
    )
    body.extend(ref.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(f"{base}/profiles", data=bytes(body), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _vs_ref_text(ref: Path, cfg) -> str:
    side = ref.with_suffix(".txt")
    if side.is_file():
        text = side.read_text("utf-8").strip()
        if text:
            return text
    return str(cfg.get("refText") or "").strip()


def _vs_voice_id(base: str, cfg) -> str:
    explicit = str(cfg.get("profileId") or "").strip()
    if explicit:
        return explicit
    ref = Path(str(cfg.get("refWav") or ""))
    if not ref.is_file():
        raise RuntimeError(f"找不到参考音色：{ref}")
    ref_text = _vs_ref_text(ref, cfg)
    key = "|".join([
        base,
        hashlib.sha1(ref.read_bytes()).hexdigest(),
        hashlib.sha1(ref_text.encode("utf-8")).hexdigest(),
    ])
    cache = {}
    if VS_PROFILE_CACHE.is_file():
        try:
            cache = json.loads(VS_PROFILE_CACHE.read_text("utf-8"))
        except Exception:
            cache = {}
    hit = cache.get(key)
    if isinstance(hit, dict) and hit.get("id") and _vs_profile_exists(base, hit["id"]):
        return str(hit["id"])
    try:
        for row in _vs_read_json(f"{base}/profiles", timeout=15):
            if row.get("name") == ref.stem and (row.get("ref_text") or "").strip() == ref_text:
                cache[key] = {"id": row["id"], "name": row["name"]}
                VS_PROFILE_CACHE.parent.mkdir(parents=True, exist_ok=True)
                VS_PROFILE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), "utf-8")
                return str(row["id"])
    except Exception:
        pass
    profile = _vs_create_profile(base, ref, ref_text)
    cache[key] = {"id": profile["id"], "name": profile.get("name") or ref.stem}
    VS_PROFILE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    VS_PROFILE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), "utf-8")
    return str(profile["id"])


def _vs_split_text(text: str, max_chars: int):
    pieces = [p.strip() for p in re.split(r"(?<=[，。！？；：、,.!?;:])", text) if p.strip()]
    chunks, buf = [], ""
    for piece in pieces:
        while len(piece) > max_chars:
            if buf:
                chunks.append(buf)
                buf = ""
            chunks.append(piece[:max_chars])
            piece = piece[max_chars:]
        if not piece:
            continue
        if buf and len(buf) + len(piece) > max_chars:
            chunks.append(buf)
            buf = piece
        else:
            buf += piece
    if buf:
        chunks.append(buf)
    if len(chunks) > 1 and len(chunks[-1]) < 6 and len(chunks[-2]) + len(chunks[-1]) <= max_chars + 6:
        chunks[-2] += chunks[-1]
        chunks.pop()
    return chunks or [text]


def _median_f0(path: Path) -> float:
    """Median fundamental frequency of a WAV, used to catch a sudden voice break."""
    try:
        import wave

        import numpy as np

        with wave.open(str(path), "rb") as wf:
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    except Exception:
        return 0.0
    if sr <= 0 or data.size < sr // 20:
        return 0.0
    frame = int(0.04 * sr)
    hop = max(1, frame // 2)
    lo, hi = int(sr / 400), int(sr / 70)
    vals = []
    for start in range(0, data.size - frame, hop):
        seg = data[start:start + frame]
        if float(np.sqrt((seg ** 2).mean())) < 0.01:
            continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, "full")[seg.size - 1:]
        if hi >= ac.size:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]:
            vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0


def _onset_f0(path: Path, span: float = 0.12) -> float:
    """Median F0 of the first voiced frames: catches a falsetto-like opening."""
    try:
        import wave

        import numpy as np

        with wave.open(str(path), "rb") as wf:
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    except Exception:
        return 0.0
    if sr <= 0 or data.size < sr // 20:
        return 0.0
    frame = int(0.04 * sr)
    hop = max(1, frame // 2)
    lo, hi = int(sr / 500), int(sr / 70)
    need = max(2, int(span / (hop / sr)))
    vals = []
    for start in range(0, data.size - frame, hop):
        if len(vals) >= need:
            break
        seg = data[start:start + frame]
        if float(np.sqrt((seg ** 2).mean())) < 0.015:
            continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, "full")[seg.size - 1:]
        if hi >= ac.size:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.45 * ac[0]:
            vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0


def _apply_effect_preset(path: Path, preset: str, backend_dir: str, leveler_amount=None) -> bool:
    """Run VoiceStudio's own effect chain on a finished take (parity with /generate)."""
    if not preset or preset == "raw":
        return False
    try:
        import sys
        import wave

        import numpy as np
        import torch

        if backend_dir and backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from services import audio_dsp  # type: ignore[import-not-found]

        chain = audio_dsp.get_effect_chain(preset)
        if leveler_amount is not None:
            amount = float(leveler_amount)
            chain = [
                ({**step, "amount": amount} if step.get("type") == "leveler" else step)
                for step in chain
            ]
        with wave.open(str(path), "rb") as wf:
            sr = wf.getframerate()
            channels = wf.getnchannels()
            data = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        if channels > 1:
            data = data.reshape(-1, channels).mean(axis=1)
        tensor = torch.from_numpy(data.copy())
        tensor = audio_dsp.apply_effects_chain(tensor, sample_rate=sr, chain=chain)
        tensor = audio_dsp.normalize_audio(tensor, target_dBFS=-2.0)
        out = np.clip(tensor.detach().cpu().numpy(), -1.0, 1.0)
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes((out * 32767.0).astype("<i2").tobytes())
        return True
    except Exception as exc:  # noqa: BLE001 - DSP is an enhancement, never fatal
        print(f"  效果链（{preset}）跳过：{exc}")
        return False


def _synth_chunks_steady(texts, outs, cfg, out_dir, synth_chunk, tag="vs"):
    base_speed = float(cfg.get("speed") or 1.0)
    steady = cfg.get("steady") is not False
    target_cps = float(cfg.get("targetCps") or 0)
    max_chars = max(8, int(cfg.get("maxChars") or 22))
    sub_gap = float(cfg.get("subGap", 0.12))
    seed = cfg.get("seed")
    seed_base = int(seed) if str(seed if seed is not None else "").strip() else None
    tone_tol = float(cfg.get("toneTolerance") or 0.09)
    try:
        ref_f0 = _median_f0(Path(str(cfg.get("refWav") or "")))
    except Exception:
        ref_f0 = 0.0
    f0_samples = []

    if steady and target_cps > 0:
        print(f"{tag} 逐段稳速：目标 {target_cps:.2f} 字/秒，每段 ≤{max_chars} 字")
    else:
        print(f"{tag} 固定语速：{base_speed:.2f}×，每段 ≤{max_chars} 字")
    if ref_f0 > 0:
        print(f"音高守护：参考 {ref_f0:.0f}Hz，允许偏离 ±{tone_tol * 100:.0f}%")

    for text, out in zip(texts, outs):
        chunks = _vs_split_text(text, max_chars)
        tmp = out.parent / (out.stem + f".{tag}")
        tmp.mkdir(parents=True, exist_ok=True)
        raws = []
        for i, chunk in enumerate(chunks):
            desired = spoken_units(chunk) / target_cps if (steady and target_cps > 0) else 0.0
            speed = base_speed
            raw_path = tmp / f"c{i:02d}.wav"
            pool = f0_samples + ([ref_f0] if ref_f0 > 0 else [])
            target_f0 = float(sorted(pool)[len(pool) // 2]) if pool else 0.0

            best_dev, best_pcm, chosen_seed, best_score = None, None, seed_base, None
            pcm = b""
            used = 0
            for attempt in range(3):
                s = (seed_base + attempt) if seed_base is not None else None
                pcm = synth_chunk(chunk, round(speed, 3), s)
                used += 1
                raw_path.write_bytes(pcm)
                f0 = _median_f0(raw_path) if target_f0 > 0 else 0.0
                dev = abs(f0 - target_f0) / target_f0 if (target_f0 > 0 and f0 > 0) else 0.0
                onset = _onset_f0(raw_path) if target_f0 > 0 else 0.0
                onset_ratio = (onset / target_f0) if (target_f0 > 0 and onset > 0) else 1.0
                score = dev + 0.6 * abs(min(onset_ratio, 1.6) - 1.0)
                if best_score is None or score < best_score:
                    best_score, best_dev, best_pcm, chosen_seed = score, dev, pcm, s
                if dev <= tone_tol and onset_ratio <= 1.32:
                    break
            if best_pcm is not None and best_pcm is not pcm:
                raw_path.write_bytes(best_pcm)
            if target_f0 > 0 and best_dev is not None and best_dev > tone_tol:
                print(f"  {out.stem} 段{i + 1} 音高仍偏离 {best_dev * 100:.0f}%（目标 {target_f0:.0f}Hz），已取最接近版本")
            elif used > 1:
                print(f"  {out.stem} 段{i + 1} 音高不稳，换种子重合成 {used} 次后稳定")

            for _ in range(3):
                if not desired:
                    break
                duration = probe_duration(raw_path)
                if duration <= 0 or abs(duration - desired) / desired <= 0.04:
                    break
                # 引擎原生 speed 走 CosyVoice 的 token 级 pace 控制，压到 0.85 会把
                # 句首抬成气声假声（实测起音 275Hz -> 310~350Hz）。这里保持 1.0
                # 合成，再用 atempo 对齐时长，音高和韵律不变。
                ratio = duration / desired
                if ratio > 1.6 or ratio < 0.62:
                    break
                tmp_fit = tmp / f"fit{i:02d}.wav"
                run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_path),
                     "-af", f"atempo={ratio:.5f}", "-ar", "24000", "-ac", "1",
                     "-c:a", "pcm_s16le", str(tmp_fit)])
                tmp_fit.replace(raw_path)

            f0_final = _median_f0(raw_path) if target_f0 > 0 else 0.0
            if f0_final > 0:
                f0_samples.append(f0_final)
            raws.append(raw_path)

        passthrough = bool(cfg.get("passthrough"))
        padded = []
        for i, raw_path in enumerate(raws):
            shaped = tmp / f"p{i:02d}.wav"
            if passthrough and len(raws) == 1:
                shaped.write_bytes(raw_path.read_bytes())
                padded.append(shaped)
                continue
            filters = [
                "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB",
                "areverse",
                "silenceremove=start_periods=1:start_duration=0.03:start_threshold=-50dB",
                "areverse",
            ]
            if i < len(raws) - 1:
                filters.append(f"apad=pad_dur={sub_gap:.3f}")
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw_path),
                 "-af", ",".join(filters), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(shaped)])
            padded.append(shaped)

        list_file = tmp / "concat.txt"
        list_file.write_text(
            "\n".join(f"file '{p.as_posix()}'" for p in padded),
            encoding="utf-8",
        )
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
             "-f", "concat", "-safe", "0", "-i", str(list_file),
             "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(out)])

        preset = str(cfg.get("effectPreset") or "").strip()
        if preset and preset != "raw" and not passthrough:
            backend_dir = str(cfg.get("dspBackendDir") or default_path("OD_VOICESTUDIO_BACKEND", "vendor", "VoiceStudio", "backend"))
            _apply_effect_preset(out, preset, backend_dir, cfg.get("effectLevelerAmount"))


def synth_voicestudio(texts, outs, cfg, out_dir):
    base = str(cfg.get("apiBase") or "http://127.0.0.1:3900").rstrip("/")
    if not _vs_healthy(base):
        raise RuntimeError(f"VoiceStudio 服务未启动（{base}），请先在配音方案里点“启动服务”。")

    model = str(cfg.get("model") or "cosyvoice")
    voice_id = _vs_voice_id(base, cfg)
    seed = cfg.get("seed")
    instruct = str(cfg.get("instruct") or "").strip() or str(cfg.get("instructPreset") or "").strip()
    endpoint = str(cfg.get("endpoint") or "speech").strip().lower()
    language = str(cfg.get("language") or "Chinese")
    if instruct:
        print(f"风格指令：{instruct[:40]}")
    if endpoint == "generate":
        print("调用 UI 同一接口 /generate（与界面生成完全同参）")

    def synth_chunk(chunk, speed, seed_override=None):
        use_seed = seed_override if seed_override is not None else (
            int(seed) if seed not in (None, "") else None
        )
        if endpoint == "generate":
            fields = {
                "text": chunk,
                "profile_id": voice_id,
                "engine": model,
                "speed": f"{speed:.3f}",
                "language": language,
                "denoise": "true",
                "postprocess_output": "true",
                "guidance_scale": "2.0",
                "effect_preset": str(cfg.get("effectPreset") or "broadcast"),
                "wav_bits": "16",
                "max_chunk_chars": "0",
            }
            if use_seed is not None:
                fields["seed"] = str(int(use_seed))
            if instruct:
                fields["instruct"] = instruct
            return _vs_post_form(f"{base}/generate", fields)

        payload = {
            "model": model,
            "input": chunk,
            "voice": voice_id,
            "response_format": "wav",
            "speed": speed,
        }
        if use_seed is not None:
            payload["seed"] = int(use_seed)
        if instruct:
            payload["instruct"] = instruct
        return _vs_post_json(f"{base}/v1/audio/speech", payload)

    _synth_chunks_steady(texts, outs, cfg, out_dir, synth_chunk, tag="VoiceStudio")


def synth_local3(texts, outs, cfg, out_dir):
    """CosyVoice 3 driven in-process via the engine's own sidecar (no server)."""
    import sys as _sys

    scripts = HERE / "scripts"
    if str(scripts) not in _sys.path:
        _sys.path.insert(0, str(scripts))
    from cosyvoice3_worker import LocalCosyVoice

    ref = Path(cfg.get("refWav") or default_path("OD_VOICEREF", "assets", "voice-ref", "0226_prompt.wav"))
    if not ref.is_file():
        raise RuntimeError(f"找不到参考音色：{ref}")
    ref_text = str(cfg.get("refText") or "").strip()
    if not ref_text:
        sidecar_txt = ref.with_suffix(".txt")
        if sidecar_txt.is_file():
            ref_text = sidecar_txt.read_text(encoding="utf-8").strip()
    if not ref_text:
        raise RuntimeError(f"缺少参考文本（{ref.with_suffix('.txt')}）")

    seed = cfg.get("seed")
    instruct = str(cfg.get("instruct") or "").strip() or str(cfg.get("instructPreset") or "").strip()
    if instruct:
        print(f"风格指令：{instruct[:40]}")
    log_path = out_dir / "cosyvoice3_worker.log"
    print(f"本机直连 CosyVoice 3（{cfg.get('modelDir') or 'Fun-CosyVoice3-0.5B'}），首次加载约 1–2 分钟...", flush=True)

    engine = LocalCosyVoice(log_path=log_path)
    try:
        def synth_chunk(chunk, speed, seed_override=None):
            use_seed = seed_override if seed_override is not None else (
                int(seed) if seed not in (None, "") else None
            )
            pcm = engine.synthesize(
                chunk,
                ref_audio=str(ref),
                ref_text=ref_text,
                speed=speed,
                seed=use_seed,
                instruct=instruct or None,
            )
            tmp_wav = out_dir / f".local3_{abs(hash((chunk, speed))) % 10 ** 8}.wav"
            LocalCosyVoice.write_wav(pcm, tmp_wav)
            data = tmp_wav.read_bytes()
            tmp_wav.unlink(missing_ok=True)
            return data

        _synth_chunks_steady(texts, outs, cfg, out_dir, synth_chunk, tag="local3")
    finally:
        engine.close()


def synth_indextts(texts, outs, cfg, out_dir):
    import subprocess

    repo = Path(cfg.get("repoPath") or default_path("OD_INDEXTTS_REPO", "vendor", "indextts"))
    python = Path(cfg.get("python") or os.environ.get("OD_INDEXTTS_PYTHON") or repo / ".venv" / "Scripts" / "python.exe")
    helper = Path(cfg.get("batchScript", HERE / "tts" / "indextts_batch.py"))
    model_dir = Path(cfg.get("modelDir", repo / "checkpoints"))
    prompt = Path(cfg.get("promptWav", ""))

    if not python.exists():
        raise RuntimeError(f"找不到 IndexTTS 的 Python：{python}")
    if not prompt.exists():
        raise RuntimeError(f"找不到参考音色：{prompt}")

    jobs = [
        {"id": out.name.split(".")[0], "text": text, "out": str(out)}
        for text, out in zip(texts, outs)
    ]
    jobs_file = out_dir / "indextts_jobs.json"
    jobs_file.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), "utf-8")

    cmd = [
        str(python), str(helper),
        "--jobs", str(jobs_file),
        "--model-dir", str(model_dir),
        "--prompt", str(prompt),
        "--lang", cfg.get("lang", "ZH"),
    ]
    if cfg.get("fp32"):
        cmd.append("--fp32")
    if cfg.get("useQwenEmo"):
        cmd.append("--qwen-emo")
    if cfg.get("device"):
        cmd.extend(["--device", cfg["device"]])

    env = dict(os.environ)
    env["PYTHONPATH"] = str(repo)
    env["PYTHONUTF8"] = "1"

    print("IndexTTS 逐句合成中（4GB 显存下单句约 3 分钟，首次更慢）...", flush=True)
    result = subprocess.run(cmd, cwd=str(repo), env=env)
    if result.returncode != 0:
        raise RuntimeError(f"IndexTTS 合成失败，退出码 {result.returncode}")


def find_kaggle_bin(cfg):
    explicit = cfg.get("kaggleBin") or os.environ.get("KAGGLE_BIN")
    if explicit and Path(explicit).is_file():
        return str(Path(explicit))
    found = shutil.which("kaggle") or shutil.which("kaggle.exe")
    if found:
        return found
    home = Path(os.environ.get("USERPROFILE") or Path.home())
    for candidate in (home / ".local" / "bin" / "kaggle.exe", home / ".local" / "bin" / "kaggle"):
        if candidate.is_file():
            return str(candidate)
    return None


def synth_kaggle(texts, outs, cfg, out_dir, ids):
    runner = HERE / "tts" / "kaggle" / "run_kaggle_tts.py"
    if not runner.is_file():
        raise RuntimeError(f"找不到 Kaggle 配音脚本：{runner}")

    prompt = Path(cfg.get("promptWav", ""))
    if not prompt.is_file():
        raise RuntimeError(f"找不到参考音色：{prompt}")

    missing = [
        (sid, text, out)
        for sid, text, out in zip(ids, texts, outs)
        if not (out.is_file() and out.stat().st_size > 10000)
    ]
    if not missing:
        print("Kaggle 配音命中缓存，跳过合成")
        return

    cache = out_dir / "kaggle"
    cache.mkdir(parents=True, exist_ok=True)
    job_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{os.getpid()}"
    request_path = cache / f"request-{job_id}.json"
    summary_path = cache / "last_run.json"
    if summary_path.exists():
        summary_path.unlink()

    request = {
        "job_id": job_id,
        "text": "\n".join(texts),
        "segments": [{"id": sid, "text": text} for sid, text, _ in missing],
        "voice_path": str(prompt),
        "lang": cfg.get("lang", "ZH"),
        "max_text_tokens_per_segment": int(cfg.get("maxTextTokens", 120)),
        "use_bf16": bool(cfg.get("useBf16", False)),
        "duration_factor": float(cfg.get("durationFactor", 1.0)),
        "output_name": "audio.wav",
        "repo_ref": cfg.get("repoRef", "main"),
        "model_repo": cfg.get("modelRepo", "IndexTeam/IndexTTS-2.5"),
    }
    if cfg.get("repoUrl"):
        request["repo_url"] = cfg["repoUrl"]
    request_path.write_text(json.dumps(request, ensure_ascii=False, indent=2), "utf-8")

    cmd = [
        cfg.get("python") or sys.executable,
        str(runner),
        "--request", str(request_path),
        "--voice", str(prompt),
        "--out", str(cache),
        "--work-dir", str(cache / "jobs"),
        "--json-out", str(summary_path),
        "--job-id", job_id,
        "--timeout", str(int(cfg.get("timeoutSec", 7200))),
        "--poll-interval", str(int(cfg.get("pollIntervalSec", 20))),
        "--repo-ref", cfg.get("repoRef", "main"),
        "--model-repo", cfg.get("modelRepo", "IndexTeam/IndexTTS-2.5"),
    ]
    if cfg.get("accelerator"):
        cmd += ["--accelerator", cfg["accelerator"]]
    if cfg.get("modelDataset"):
        cmd += ["--model-dataset", cfg["modelDataset"]]
    if cfg.get("kernel"):
        cmd += ["--kernel", cfg["kernel"]]

    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    kaggle_bin = find_kaggle_bin(cfg)
    if kaggle_bin:
        env["KAGGLE_BIN"] = kaggle_bin

    print(
        f"Kaggle 批量合成 {len(missing)} 句（排队 + 冷启动通常 10–20 分钟，"
        f"超时 {cfg.get('timeoutSec', 7200)} 秒）...",
        flush=True,
    )
    result = subprocess.run(cmd, cwd=str(runner.parent), env=env,
                            text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(f"Kaggle 合成失败，退出码 {result.returncode}")

    if not summary_path.is_file():
        raise RuntimeError(f"Kaggle 未返回摘要：{summary_path}")
    summary = json.loads(summary_path.read_text("utf-8"))
    if summary.get("status") != "ok":
        raise RuntimeError(
            f"Kaggle 合成失败：{summary.get('error')}\n日志：{summary.get('log_path')}"
        )

    job_root = cache / (summary.get("job_id") or job_id)
    manifests = sorted(job_root.glob(f"**/output/{job_id}/manifest.json"))
    if not manifests:
        manifests = sorted(job_root.glob("**/manifest.json"))
    if not manifests:
        raise RuntimeError(f"Kaggle 输出中缺少 manifest.json：{job_root}")

    manifest = json.loads(manifests[0].read_text("utf-8"))
    by_id = {segment["id"]: segment for segment in manifest.get("segments", [])}
    out_by_id = {sid: out for sid, _, out in missing}
    for sid, out in out_by_id.items():
        segment = by_id.get(sid)
        if not segment:
            raise RuntimeError(f"Kaggle 未返回句子 {sid}")
        src = Path(segment["file"])
        if not src.is_absolute():
            src = job_root / src
        if not src.is_file():
            candidates = sorted(job_root.glob(f"**/segments/{sid}.wav"))
            if not candidates:
                raise RuntimeError(f"Kaggle 返回路径不存在：{src}")
            src = candidates[0]
        shutil.copy2(src, out)
        print(f"  {sid} {segment.get('duration_sec', 0):.2f}s <- {src.name}")


def _vs_transcribe(base: str, path: Path, model: str = "whisperx", language: str = "zh"):
    """Word-level timestamps from VoiceStudio's own ASR, used to place page cuts."""
    import json as _json
    import uuid

    boundary = uuid.uuid4().hex
    body = bytearray()

    def field(key: str, value: str) -> None:
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        body.extend(str(value).encode("utf-8") + b"\r\n")

    field("model", model)
    field("language", language)
    field("response_format", "verbose_json")
    field("timestamp_granularities[]", "word")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="file"; filename="voice.wav"\r\n')
    body.extend(b"Content-Type: audio/wav\r\n\r\n")
    body.extend(path.read_bytes())
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    req = urllib.request.Request(f"{base}/v1/audio/transcriptions", data=bytes(body), method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=3600) as resp:
        return _json.loads(resp.read())


def _sentence_bounds(sentences, words, duration: float):
    """Map each sentence end onto the ASR word timeline."""
    import difflib

    def clean(text: str) -> str:
        return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", text)

    flat = []
    for w in words:
        start = float(w.get("start") or 0.0)
        end = float(w.get("end") or start)
        for ch in clean(str(w.get("word") or "")):
            flat.append((ch, start, end))
    asr = "".join(c for c, _, _ in flat)
    expected = "".join(clean(s) for s in sentences)
    if not flat or not expected:
        step = duration / max(1, len(sentences))
        return [step * (i + 1) for i in range(len(sentences))]

    sm = difflib.SequenceMatcher(None, expected, asr, autojunk=False)
    exp2asr = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            exp2asr[a + k] = b + k

    bounds, pos, last = [], 0, 0.0
    for s in sentences:
        pos += len(clean(s))
        idx = exp2asr.get(pos - 1)
        if idx is None:
            cand = [v for k, v in exp2asr.items() if k < pos]
            idx = max(cand) if cand else len(flat) - 1
        t = flat[min(idx, len(flat) - 1)][2]
        t = max(t, last + 0.4)
        t = min(t, duration)
        bounds.append(t)
        last = t
    return bounds


def _engine_take(text: str, cfg, out_dir: Path, raw: Path) -> None:
    """Whole script through the local engine in model-safe chunks with crossfades."""
    py = str(cfg.get("enginePython") or default_path("OD_COSYVOICE_PYTHON", "vendor", "CosyVoice", ".venv", "Scripts", "python.exe"))
    script = Path(__file__).resolve().parent / "scripts" / "cosyvoice_nosplit.py"
    ref = Path(str(cfg.get("refWav") or ""))
    if not ref.is_file():
        raise RuntimeError(f"ref wav missing: {ref}")
    ref_text = _vs_ref_text(ref, cfg)
    work = out_dir / "_engine"
    work.mkdir(parents=True, exist_ok=True)
    txt = work / "take.txt"
    txt.write_text(text, encoding="utf-8")
    rt = work / "ref.txt"
    rt.write_text(ref_text, encoding="utf-8")
    cmd = [
        py, str(script),
        "--text-file", str(txt), "--out", str(raw), "--ref", str(ref),
        "--ref-text-file", str(rt),
        "--chunk-chars", str(int(cfg.get("chunkChars") or 150)),
        "--xfade", str(float(cfg.get("xfadeSeconds") or 0.05)),
    ]
    if cfg.get("seed") not in (None, ""):
        cmd += ["--seed", str(int(cfg["seed"]))]
    print("  engine take: chunked synthesis with crossfaded joins")
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 or not raw.is_file():
        tail = (proc.stderr or "")[-900:] or (proc.stdout or "")[-900:]
        raise RuntimeError(f"engine take failed: {tail}")
    for line in (proc.stdout or "").splitlines():
        if line.startswith("{"):
            print("   ", line)
    preset = str(cfg.get("effectPreset") or "broadcast")
    if preset and preset != "raw":
        backend_dir = str(cfg.get("dspBackendDir") or default_path("OD_VOICESTUDIO_BACKEND", "vendor", "VoiceStudio", "backend"))
        _apply_effect_preset(raw, preset, backend_dir, cfg.get("effectLevelerAmount"))


def _speech_silences(data, sr, floor_db: float = -45.0, min_len: float = 0.10):
    """Silence midpoints; used to snap a page cut away from a misheard word."""
    import numpy as np

    win = max(1, int(0.02 * sr))
    n = max(1, len(data) // win)
    frames = data[: n * win].reshape(n, win)
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    quiet = db < floor_db
    out, i = [], 0
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            if (j - i) * 0.02 >= min_len:
                out.append((i * 0.02, j * 0.02))
            i = j
        else:
            i += 1
    return out


def _insert_page_pauses(seg, sr, bounds, lead, silences, target):
    """Lengthen the pause that already exists at each page turn (no cuts)."""
    import numpy as np

    rel = [(max(0.0, s0 - lead), s1 - lead) for s0, s1 in silences]
    inserts, cuts = [], []
    shift = 0.0
    for b in bounds[:-1]:
        t = b - lead + shift
        host = None
        for s0, s1 in rel:
            a, z = s0 + shift, s1 + shift
            if a - 0.10 <= t <= z + 0.10:
                host = (a, z)
                break
        if host is None:
            # the model ran this sentence into the next one: put the breath at
            # the nearest real pause we can find nearby
            cand = [(s0 + shift, s1 + shift) for s0, s1 in rel]
            if cand:
                near = min(cand, key=lambda az: min(abs(az[0] - t), abs(az[1] - t)))
                if min(abs(near[0] - t), abs(near[1] - t)) <= 0.60:
                    host = near
        if host is None:
            cuts.append(t)
            continue
        existing = host[1] - host[0]
        extra = target - existing
        if extra > 0.02:
            inserts.append(((host[0] + host[1]) / 2, extra))
            cuts.append((host[0] + host[1] + extra) / 2)
            shift += extra
        else:
            cuts.append((host[0] + host[1]) / 2)

    if not inserts:
        return seg, cuts, 0.0

    out, cursor, offset = [], 0.0, 0.0
    ramp = max(1, int(0.010 * sr))
    for at, extra in inserts:
        orig = max(cursor, at - offset)
        i0 = int(orig * sr)
        head = seg[int(cursor * sr): i0].copy()
        r = min(ramp, head.size)
        if r > 1:
            head[-r:] *= np.linspace(1.0, 0.0, r, dtype=np.float32)
        out.append(head)
        out.append(np.zeros(int(extra * sr), dtype=np.float32))
        cursor = orig
        offset += extra
    tail = seg[int(cursor * sr):].copy()
    r = min(ramp, tail.size)
    if r > 1:
        tail[:r] *= np.linspace(0.0, 1.0, r, dtype=np.float32)
    out.append(tail)
    return np.concatenate(out), cuts, shift


def _steady_bounds(bounds, texts, duration: float, silences) -> list:
    """Keep ASR cuts, but move any implausible one onto the nearest real pause."""
    total = sum(len(t) for t in texts) or 1
    mids = [round((a + b) / 2, 3) for a, b in silences] or [0.0]
    cum, fixed, prev = 0, [], 0.0
    for i, text in enumerate(texts):
        cum += len(text)
        expected = duration * cum / total
        want = duration * (cum - len(text)) / total
        got = bounds[i] if i < len(bounds) else duration
        page = got - prev
        page_want = max(0.35, expected - want)
        if abs(page - page_want) > 0.45 * page_want + 0.22:
            near = min(mids, key=lambda t: abs(t - expected))
            if abs(near - expected) < 1.6 and near > prev + 0.2:
                got = near
        # A flip reads best inside a real pause: prefer the nearest one.
        near = min(mids, key=lambda t: abs(t - expected))
        if abs(near - got) <= 0.60:
            got = near
        got = max(got, prev + 0.25)
        fixed.append(min(got, duration))
        prev = fixed[-1]
    return fixed


def single_pass_narration(slides, cfg, out_dir: Path, voice_path: Path, timeline_path: Path):
    """One continuous take for the whole script, pages located by ASR pauses."""
    import numpy as np
    import soundfile as sf

    base = str(cfg.get("apiBase") or "http://127.0.0.1:3900").rstrip("/")
    if not _vs_healthy(base):
        raise RuntimeError(f"VoiceStudio 服务未启动（{base}）")

    texts = [normalize_tts_text(s.get("speech") or s["title"]) for s in slides]
    merged = "".join(texts)
    voice_id = _vs_voice_id(base, cfg)
    print(f"整篇一次连续合成：{len(merged)} 字（{len(texts)} 页）")

    fields = {
        "text": merged,
        "profile_id": voice_id,
        "engine": str(cfg.get("model") or "cosyvoice"),
        "speed": "1.000",
        "language": str(cfg.get("language") or "Chinese"),
        "denoise": "true",
        "postprocess_output": "true",
        "guidance_scale": "2.0",
        "effect_preset": str(cfg.get("effectPreset") or "broadcast"),
        "wav_bits": "16",
        "max_chunk_chars": "0",
    }
    seed = cfg.get("seed")
    if seed not in (None, ""):
        fields["seed"] = str(int(seed))
    raw = out_dir / "voicestudio.full.wav"
    side = out_dir / "voicestudio.full.txt"
    if raw.is_file() and side.is_file() and side.read_text("utf-8") == merged:
        print(f"  复用整篇合成 {probe_duration(raw):.2f}s")
    elif cfg.get("engineTake") is not False:
        _engine_take(merged, cfg, out_dir, raw)
        side.write_text(merged, encoding="utf-8")
        print(f"  engine take {probe_duration(raw):.2f}s")
    else:
        raw.write_bytes(_vs_post_form(f"{base}/generate", fields))
        side.write_text(merged, encoding="utf-8")
        print(f"  合成完成 {probe_duration(raw):.2f}s")

    print("  识别停顿以定位分页…")
    result = _vs_transcribe(base, raw, str(cfg.get("asrModel") or "whisperx"))
    words = result.get("words") or []
    if not words:
        raise RuntimeError("ASR 未返回词级时间戳，无法自动分页")
    print(f"  识别到 {len(words)} 个字，文本：{str(result.get('text'))[:40]}")

    data, sr = sf.read(str(raw), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    duration = len(data) / sr
    bounds = _sentence_bounds(texts, words, duration)
    silences = _speech_silences(data, sr)
    bounds = _steady_bounds(bounds, texts, duration, silences)
    loud = np.flatnonzero(np.abs(data) > 10 ** (-45 / 20.0))
    speech_end = float(loud[-1]) / sr if loud.size else duration
    bounds[-1] = max(bounds[-1], min(speech_end, duration))

    lead = max(0.05, float(words[0].get("start") or 0.0) - 0.12)
    tail_end = min(duration, max(bounds[-1] + 0.45, speech_end + 0.25))
    seg = data[int(lead * sr): int(tail_end * sr)]
    page_pause = cfg.get("pagePauseSeconds")
    page_pause = 0.45 if page_pause is None else float(page_pause)
    cuts = [b - lead for b in bounds[:-1]]
    if page_pause > 0 and len(bounds) > 1:
        breaths = _speech_silences(data, sr, -42.0, 0.05)
        seg, cuts, added = _insert_page_pauses(seg, sr, bounds, lead, breaths, page_pause)
        print(f"  page pauses -> {page_pause:.2f}s (added {added:.2f}s)")
    fade = max(1, int(0.012 * sr))
    seg = seg.copy()
    seg[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
    seg[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    sf.write(str(voice_path), seg, sr, subtype="PCM_16")

    items, cursor = [], 0.0
    starts = [0.0] + cuts
    ends = cuts + [len(seg) / sr]
    for s, a, b in zip(slides, starts, ends):
        a, b = max(0.0, a), min(len(seg) / sr, b)
        items.append({
            "id": s["id"], "index": s["index"],
            "start": round(a, 3), "end": round(b, 3), "duration": round(b - a, 3),
            "speech": s.get("speech") or s["title"],
        })
        cursor = b
    timeline = {
        "provider": "voicestudio",
        "sampleRate": sr,
        "gapSeconds": 0.0,
        "total": round(len(seg) / sr, 3),
        "items": items,
    }
    timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), "utf-8")

    gain = float(cfg.get("masterGainDb") or 0.0)
    if gain:
        boosted = out_dir / "voice.mastered.wav"
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(voice_path),
             "-af", f"volume={gain:.2f}dB,alimiter=limit=0.891:attack=5:release=60:level=0",
             "-ar", str(sr), "-ac", "1", "-c:a", "pcm_s16le", str(boosted)])
        boosted.replace(voice_path)

    for it in items:
        print(f"  {it['id']} {it['start']:6.2f}-{it['end']:6.2f}")
    print(f"配音完成：{timeline_path}（总时长 {timeline['total']:.2f}s）-> {voice_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slides", default=str(OUT_ROOT / "slides.json"))
    ap.add_argument("--out-dir", default=str(OUT_ROOT / "tts"))
    ap.add_argument("--voice", default=str(OUT_ROOT / "voice.wav"))
    ap.add_argument("--timeline", default=str(OUT_ROOT / "timeline.json"))
    ap.add_argument("--config", default="pipeline/tts/config.json")
    ap.add_argument("--provider", default=None)
    ap.add_argument("--gap", type=float, default=None)
    ap.add_argument("--no-tighten", action="store_true", help="disable micro-pause tightening")
    ap.add_argument("--speak-rate", type=float, default=None, help="语速倍率，<1 更慢（如 0.94）")
    ap.add_argument("--rate-match", type=float, default=None, help="逐句对齐到目标字/秒，如 4.0")
    ap.add_argument("--lead-in", type=float, default=0.0, help="第一句前垫静音秒数，如 0.25")
    ap.add_argument("--page-pause", type=float, default=None, help="翻页处停顿总长（秒），默认取 pagePauseSeconds")
    args = ap.parse_args()

    root = HERE.parent
    resolve = lambda p: (root / p) if not os.path.isabs(p) else Path(p)

    slides_path = resolve(args.slides)
    out_dir = resolve(args.out_dir)
    voice_path = resolve(args.voice)
    timeline_path = resolve(args.timeline)
    cfg_path = resolve(args.config)

    data = json.loads(slides_path.read_text("utf-8"))
    slides = data["slides"]

    cfg = {}
    if cfg_path.exists():
        cfg = json.loads(cfg_path.read_text("utf-8"))

    provider = args.provider or os.environ.get("OD_TTS_PROVIDER") or cfg.get("provider", "indextts")
    vs_cfg = cfg.get("voicestudio", {})
    if provider == "voicestudio" and vs_cfg.get("singlePass"):
        out_dir.mkdir(parents=True, exist_ok=True)
        vs_cfg = dict(vs_cfg)
        if args.page_pause is not None:
            vs_cfg["pagePauseSeconds"] = args.page_pause
        elif vs_cfg.get("pagePauseSeconds") is None and cfg.get("pagePauseSeconds") is not None:
            vs_cfg["pagePauseSeconds"] = cfg["pagePauseSeconds"]
        single_pass_narration(slides, vs_cfg, out_dir, voice_path, timeline_path)
        return
    gap = args.gap if args.gap is not None else float(cfg.get("gapSeconds", 0.32))
    provider_cfg = cfg.get(provider) if isinstance(cfg.get(provider), dict) else {}
    speak_rate = (
        args.speak_rate if args.speak_rate is not None
        else float(provider_cfg.get("speakRate", cfg.get("speakRate", 1.0)))
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    texts = [s.get("speech") or s["title"] for s in slides]
    tts_texts = [normalize_tts_text(t) for t in texts]
    raw_paths = [out_dir / f"{s['id']}.{provider}.raw.wav" for s in slides]

    print(f"合成配音：{provider}，共 {len(texts)} 句")

    if provider == "cosyvoice":
        synth_cosyvoice(tts_texts, raw_paths, cfg.get("cosyvoice", {}))
    elif provider == "voicestudio":
        synth_voicestudio(tts_texts, raw_paths, cfg.get("voicestudio", {}), out_dir)
    elif provider == "local3":
        synth_local3(tts_texts, raw_paths, cfg.get("local3", {}), out_dir)
    elif provider == "indextts":
        synth_indextts(tts_texts, raw_paths, cfg.get("indextts", {}), out_dir)
    elif provider == "kaggle":
        synth_kaggle(
            tts_texts, raw_paths, cfg.get("kaggle", {}), out_dir,
            [s["id"] for s in slides],
        )
    elif provider == "edge":
        synth_edge(tts_texts, raw_paths, cfg.get("edge", {}))
    else:
        raise SystemExit(f"未知配音引擎：{provider}")

    target_cps = args.rate_match
    if target_cps:
        print(f"逐句语速对齐：目标 {target_cps:.2f} 字/秒（单句 0.90–1.15x）")
    elif abs(speak_rate - 1.0) > 1e-4:
        print(f"语速调整：{speak_rate:.2f}x（{100 / speak_rate - 100:+.1f}% 时长）")

    norm_paths, padded_paths = [], []
    passthrough = bool(cfg.get("passthrough"))
    for s, raw, text in zip(slides, raw_paths, texts):
        norm = out_dir / f"{s['id']}.wav"
        padded = out_dir / f"{s['id']}.padded.wav"
        lead = args.lead_in if s["index"] == 0 else 0.0

        if passthrough:
            norm.write_bytes(raw.read_bytes())
            pad_append(norm, padded, gap, lead)
            norm_paths.append(norm)
            padded_paths.append(padded)
            speech_duration = probe_duration(norm)
            units = spoken_units(text)
            cps = units / speech_duration if speech_duration > 0 else 0.0
            print(
                f"  {s['id']} {probe_duration(padded):.2f}s  "
                f"{cps:.2f} 字/秒  {s['title'][:24]}（原样保留）"
            )
            continue

        units = spoken_units(text)
        factor = speak_rate
        if target_cps and units >= 8:
            raw_duration = probe_duration(raw)
            factor = target_cps * raw_duration / units
            factor = min(max(factor, 0.90), 1.15)

        normalize(raw, norm, factor)
        tight = out_dir / f"{s['id']}.tight.wav"
        if args.no_tighten:
            shaped = norm
        else:
            tighten_gaps(norm, tight)
            shaped = tight
        pad(shaped, padded, gap, lead)
        norm_paths.append(norm)
        padded_paths.append(padded)

        speech_duration = probe_duration(norm)
        cps = units / speech_duration if speech_duration > 0 else 0.0
        print(
            f"  {s['id']} {probe_duration(padded):.2f}s  "
            f"{cps:.2f} 字/秒  {s['title'][:24]}"
        )

    list_file = out_dir / "concat.txt"
    list_file.write_text(
        "\n".join(f"file '{p.as_posix()}'" for p in padded_paths),
        encoding="utf-8",
    )
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(voice_path)])

    items, cursor = [], 0.0
    for s, padded in zip(slides, padded_paths):
        dur = probe_duration(padded)
        items.append({
            "id": s["id"],
            "index": s["index"],
            "start": round(cursor, 3),
            "end": round(cursor + dur, 3),
            "duration": round(dur, 3),
            "speech": s.get("speech") or s["title"],
        })
        cursor += dur

    timeline = {
        "provider": provider,
        "sampleRate": 24000,
        "gapSeconds": gap,
        "total": round(cursor, 3),
        "items": items,
    }
    timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), "utf-8")

    if cfg.get("matchPageLevel", True):
        match_page_levels(items, voice_path)
        print("  分段响度已对齐（避免页间像开关一样忽大忽小）")
    print(f"配音完成：{timeline_path}（总时长 {cursor:.2f}s）-> {voice_path}")


if __name__ == "__main__":
    main()
