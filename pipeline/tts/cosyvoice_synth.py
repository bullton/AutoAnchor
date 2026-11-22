"""CosyVoice 本地合成适配层。

支持：
  sft        使用模型内置音色（默认，无需参考音频）
  zero_shot  使用 assets/voice-ref 下的参考音频 + 文本做音色克隆
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class CosyVoiceEngine:
    def __init__(self, cfg):
        import sys

        vendor = Path(cfg.get("vendorPath") or os.environ.get("OD_COSYVOICE_VENDOR") or ROOT / "vendor" / "CosyVoice").resolve()
        if not vendor.exists():
            raise RuntimeError(
                f"找不到 CosyVoice 代码目录：{vendor}\n"
                "请先运行 scripts/setup-cosyvoice.ps1，或把 vendorPath 指向已有仓库。"
            )
        for p in (vendor, vendor / "third_party" / "Matcha-TTS"):
            if p.exists():
                sys.path.insert(0, str(p))

        model_path = str(Path(cfg.get("modelPath") or os.environ.get("OD_COSYVOICE_MODEL") or ROOT / "models" / "CosyVoice2-0.5B").resolve())
        fp16 = bool(cfg.get("fp16", False))
        load_jit = bool(cfg.get("loadJit", False))
        load_trt = bool(cfg.get("loadTrt", False))

        if "CosyVoice2" in model_path:
            from cosyvoice.cli.cosyvoice import CosyVoice2

            self.model = CosyVoice2(model_path, load_jit=load_jit, load_trt=load_trt, fp16=fp16)
        else:
            from cosyvoice.cli.cosyvoice import CosyVoice

            self.model = CosyVoice(model_path, load_jit=load_jit, load_trt=load_trt, fp16=fp16)

        self.sample_rate = self.model.sample_rate
        self.mode = cfg.get("mode", "sft")
        self.speaker = cfg.get("speaker", "中文女")

        self.ref_wav = cfg.get("refWav") or None
        self.ref_text = cfg.get("refText") or None
        self.speed = float(cfg.get("speed", 1.0))
        self.text_frontend = bool(cfg.get("textFrontend", True))
        if self.mode in ("zero_shot", "cross_lingual") and not self.ref_wav:
            raise RuntimeError("zero_shot / cross_lingual mode requires refWav")
        if self.mode == "zero_shot" and (not self.ref_wav or not self.ref_text):
            raise RuntimeError(
                "zero_shot 模式需要同时配置 refWav 与 refText，"
                "可放在 assets/voice-ref/ 下并在 pipeline/tts/config.json 中指向。"
            )

    def synthesize(self, texts, out_paths):
        import torch
        import torchaudio

        for text, out in zip(texts, out_paths):
            if self.mode == "zero_shot":
                gen = self.model.inference_zero_shot(
                    text, self.ref_text, str(self.ref_wav), stream=False,
                    speed=self.speed, text_frontend=self.text_frontend,
                )
            elif self.mode == "cross_lingual":
                gen = self.model.inference_cross_lingual(
                    text, str(self.ref_wav), stream=False,
                    speed=self.speed, text_frontend=self.text_frontend,
                )
            else:
                gen = self.model.inference_sft(
                    text, self.speaker, stream=False,
                    speed=self.speed, text_frontend=self.text_frontend,
                )

            chunks = [part["tts_speech"] for part in gen]
            if not chunks:
                raise RuntimeError(f"CosyVoice 未返回音频：{text[:30]}")
            audio = torch.cat(chunks, dim=1) if len(chunks) > 1 else chunks[0]
            torchaudio.save(str(out), audio, self.sample_rate)
