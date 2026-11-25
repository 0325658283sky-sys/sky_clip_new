"""Typecast TTS (한국어 기본 공급자).

공식 문서에서 확인한 것
(https://typecast.ai/docs/api-reference/text-to-speech/text-to-speech-with-timestamps):

  POST https://api.typecast.ai/v1/text-to-speech/with-timestamps?granularity=word
  헤더   X-API-KEY
  본문   { voice_id, text, model, language, output: { audio_format, audio_tempo } }
  응답   { audio: <base64>, words: [{text, start, end}], audio_format, audio_duration }
         start/end 단위는 **초**

**단어 단위 타임스탬프를 그대로 준다.** 한국어는 language="KOR"이고
ssfm-v31 / v30 / v21 세 모델 모두 지원한다고 표에 나와 있다.
"""
from __future__ import annotations

import base64
import os
import time

from .base import TtsNotConfigured, TtsResult, VoiceSpec, WordTiming

ENDPOINT = "https://api.typecast.ai/v1/text-to-speech/with-timestamps"
DEFAULT_MODEL = os.getenv("TYPECAST_MODEL", "ssfm-v31")
#: 목소리 ID는 계정마다 다르다. GET /v3/voices 로 목록을 본다.
DEFAULT_VOICE_ID = os.getenv("TYPECAST_VOICE_ID", "")

#: 글자당 요금. 공식 문서에 금액이 없어 비워 둔다.
USD_PER_1K_CHARS = float(os.getenv("TYPECAST_USD_PER_1K_CHARS", "0") or 0)

#: 한 번에 보낼 수 있는 글자 수 (문서 기준 1~2000)
MAX_CHARS = 2000


class TypecastSynthesizer:
    name = "typecast"

    def __init__(self, api_key: str | None = None, voice_id: str | None = None, model: str = DEFAULT_MODEL) -> None:
        self._key = api_key or os.getenv("TYPECAST_API_KEY")
        if not self._key:
            raise TtsNotConfigured("TYPECAST_API_KEY가 없습니다. 저장소 루트 .env에 넣으세요.")
        voice = voice_id or DEFAULT_VOICE_ID
        if not voice:
            raise TtsNotConfigured(
                "TYPECAST_VOICE_ID가 없습니다.\n"
                "  GET https://api.typecast.ai/v3/voices?model=" + model + " 으로 목록을 보고\n"
                "  한국어 목소리 ID(tc_ 로 시작)를 .env에 넣으세요."
            )
        self.default_voice = VoiceSpec(voice_id=voice, model=model, language="KOR")

    def synthesize(self, text: str, voice: VoiceSpec) -> TtsResult:
        import httpx

        if len(text) > MAX_CHARS:
            raise ValueError(f"한 번에 보낼 수 있는 길이를 넘었습니다 ({len(text)} > {MAX_CHARS}자).")

        body: dict[str, object] = {
            "voice_id": voice.voice_id,
            "text": text,
            "model": voice.model,
            "language": voice.language,
            "output": {"audio_format": "wav"},
        }
        if voice.speed != 1.0:
            body["output"] = {**body["output"], "audio_tempo": voice.speed}  # type: ignore[dict-item]

        started = time.monotonic()
        response = httpx.post(
            ENDPOINT,
            params={"granularity": "word"},  # 자막에 쓸 단어 단위
            headers={"X-API-KEY": self._key, "Content-Type": "application/json"},
            json=body,
            timeout=httpx.Timeout(180.0, connect=30.0),
        )
        elapsed = time.monotonic() - started
        response.raise_for_status()
        payload = response.json()

        audio = base64.b64decode(payload["audio"])
        duration_ms = int(round(float(payload.get("audio_duration") or 0) * 1000))
        words = [
            WordTiming(
                text=str(w.get("text", "")).strip(),
                start_ms=int(round(float(w["start"]) * 1000)),
                end_ms=int(round(float(w["end"]) * 1000)),
            )
            for w in (payload.get("words") or [])
            if w.get("start") is not None and w.get("end") is not None and str(w.get("text", "")).strip()
        ]

        return TtsResult(
            provider=self.name,
            audio=audio,
            audio_format=str(payload.get("audio_format") or "wav"),
            duration_ms=duration_ms or (words[-1].end_ms if words else 0),
            words=words,
            usd=USD_PER_1K_CHARS * len(text) / 1000,
            wall_seconds=elapsed,
        )
