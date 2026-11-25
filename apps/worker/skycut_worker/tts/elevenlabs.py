"""ElevenLabs TTS (기본 공급자).

공식 문서에서 확인한 것
(https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps):

  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps
  본문   { text, model_id, voice_settings }
  응답   { audio_base64, alignment: { characters[], character_start_times_seconds[],
                                       character_end_times_seconds[] } }

**글자 단위 타임스탬프만 준다.** 자막에 쓰려면 공백을 경계로 어절로 묶어야 해서
`group_characters_into_words`를 거친다. 한국어는 어절을 띄어 쓰므로 이 경계가
그대로 맞고, 시각 값은 같은 정렬 결과에서 가져오니 묶는 과정에서 오차가 생기지 않는다.

한국어(`ko`)는 `eleven_multilingual_v2` 지원 언어 목록에 들어 있다. 다만 억양이
자연스러운지는 수치로 알 수 없으니 직접 들어 보고, 어색하면 `typecast`로 바꾼다.

인증 헤더는 이 문서에 적혀 있지 않지만, 같은 API의 STT 문서에서 확인한
`xi-api-key`를 쓴다.
"""
from __future__ import annotations

import base64
import os
import time

from .base import TtsNotConfigured, TtsResult, VoiceSpec, group_characters_into_words

BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"
DEFAULT_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")

#: 글자당 요금. 공식 문서에 금액이 없어 비워 둔다.
USD_PER_1K_CHARS = float(os.getenv("ELEVENLABS_TTS_USD_PER_1K_CHARS", "0") or 0)


class ElevenLabsSynthesizer:
    name = "elevenlabs"

    def __init__(self, api_key: str | None = None, voice_id: str | None = None, model: str = DEFAULT_MODEL) -> None:
        self._key = api_key or os.getenv("ELEVENLABS_API_KEY")
        if not self._key:
            raise TtsNotConfigured("ELEVENLABS_API_KEY가 없습니다. 저장소 루트 .env에 넣으세요.")
        voice = voice_id or DEFAULT_VOICE_ID
        if not voice:
            raise TtsNotConfigured(
                "ELEVENLABS_VOICE_ID가 없습니다.\n"
                "  GET https://api.elevenlabs.io/v1/voices 로 목록을 보고 한국어 목소리 ID를 .env에 넣으세요."
            )
        self.default_voice = VoiceSpec(voice_id=voice, model=model, language="ko")

    def synthesize(self, text: str, voice: VoiceSpec) -> TtsResult:
        import httpx

        body: dict[str, object] = {"text": text, "model_id": voice.model}
        if voice.speed != 1.0:
            body["voice_settings"] = {"speed": voice.speed}

        started = time.monotonic()
        response = httpx.post(
            f"{BASE_URL}/{voice.voice_id}/with-timestamps",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": self._key, "Content-Type": "application/json"},
            json=body,
            timeout=httpx.Timeout(180.0, connect=30.0),
        )
        elapsed = time.monotonic() - started
        response.raise_for_status()
        payload = response.json()

        audio = base64.b64decode(payload["audio_base64"])
        alignment = payload.get("normalized_alignment") or payload.get("alignment") or {}
        words = group_characters_into_words(
            [str(c) for c in alignment.get("characters", [])],
            [float(v) for v in alignment.get("character_start_times_seconds", [])],
            [float(v) for v in alignment.get("character_end_times_seconds", [])],
        )

        return TtsResult(
            provider=self.name,
            audio=audio,
            audio_format="mp3",
            duration_ms=words[-1].end_ms if words else 0,
            words=words,
            usd=USD_PER_1K_CHARS * len(text) / 1000,
            wall_seconds=elapsed,
        )
