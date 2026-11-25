"""TTS 공급자 등록소와 캐시.

같은 대본·목소리·속도·모델이면 다시 만들지 않는다. 나레이션 재생성은
비용이 크고, 사용자가 템플릿만 바꿔 보는 경우가 많기 때문이다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from ..media.store import MediaStore
from .base import (
    Synthesizer,
    TtsNotConfigured,
    TtsResult,
    VoiceSpec,
    WordTiming,
    group_characters_into_words,
    spread_words,
)

PROVIDERS = ("elevenlabs", "typecast", "stub")
DEFAULT_PROVIDER = os.getenv("SKYCUT_TTS_PROVIDER", "elevenlabs")


def get_synthesizer(name: str) -> Synthesizer:
    if name == "stub":
        from .stub import StubSynthesizer

        return StubSynthesizer()
    if name == "typecast":
        from .typecast import TypecastSynthesizer

        return TypecastSynthesizer()
    if name == "elevenlabs":
        from .elevenlabs import ElevenLabsSynthesizer

        return ElevenLabsSynthesizer()
    raise TtsNotConfigured(f"모르는 TTS 공급자: {name} (있는 것: {', '.join(PROVIDERS)})")


@dataclass
class CachedNarration:
    asset_id: str
    asset: dict[str, object]
    cache_key: str
    duration_ms: int
    words: list[WordTiming]
    usd: float
    reused: bool


class NarrationCache:
    """에셋 저장소 안에 음성을 쌓아 둔다. `tts-<cacheKey>` 가 에셋 ID다."""

    def __init__(self, store: MediaStore) -> None:
        self._store = store

    def synthesize(self, synth: Synthesizer, text: str, voice: VoiceSpec) -> CachedNarration:
        key = voice.cache_key(text, synth.name)
        asset_id = f"tts-{key}"
        paths = self._store.paths(asset_id)
        meta_path = paths.path("tts.json")

        if meta_path.exists():
            import json

            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            audio_name = str(meta["audioFile"])
            if paths.exists(audio_name):
                return CachedNarration(
                    asset_id=asset_id,
                    asset=self._entry(asset_id, audio_name, int(meta["durationMs"])),
                    cache_key=key,
                    duration_ms=int(meta["durationMs"]),
                    words=[WordTiming(**w) for w in meta["words"]],
                    usd=0.0,
                    reused=True,
                )

        result = synth.synthesize(text, voice)
        if not result.words:
            # 시간 정보가 없으면 자막을 맞출 수 없다. 글자 수로 나눠서라도 채운다.
            result.words = spread_words(text, result.duration_ms)

        self._store.reserve(asset_id)
        audio_name = f"source.{result.extension}"
        paths.path(audio_name).write_bytes(result.audio)
        self._store.write_json(
            asset_id,
            "tts.json",
            {
                "provider": result.provider,
                "voiceId": voice.voice_id,
                "model": voice.model,
                "speed": voice.speed,
                "language": voice.language,
                "audioFile": audio_name,
                "durationMs": result.duration_ms,
                "text": text,
                "words": [{"text": w.text, "start_ms": w.start_ms, "end_ms": w.end_ms} for w in result.words],
            },
        )

        return CachedNarration(
            asset_id=asset_id,
            asset=self._entry(asset_id, audio_name, result.duration_ms),
            cache_key=key,
            duration_ms=result.duration_ms,
            words=result.words,
            usd=result.usd,
            reused=False,
        )

    def _entry(self, asset_id: str, audio_name: str, duration_ms: int) -> dict[str, object]:
        return {
            "id": asset_id,
            "kind": "audio",
            "variants": {"source": f"{asset_id}/{audio_name}"},
            "durationMs": duration_ms,
        }


__all__ = [
    "DEFAULT_PROVIDER",
    "PROVIDERS",
    "CachedNarration",
    "NarrationCache",
    "Synthesizer",
    "TtsNotConfigured",
    "TtsResult",
    "VoiceSpec",
    "WordTiming",
    "get_synthesizer",
    "group_characters_into_words",
    "spread_words",
]
