"""오프라인 스텁 TTS.

**실제 음성이 아니다.** 글자 수에 맞춘 길이의 무음 wav를 만들고 단어 타이밍을
붙인다. 키 없이 블로그 → 쇼츠 전체 흐름(자막 싱크 포함)을 확인하기 위한 것이다.

같은 대본에는 항상 같은 결과를 돌려주므로 테스트에 쓸 수 있다.
"""
from __future__ import annotations

import io
import wave

from .base import TtsResult, VoiceSpec, WordTiming

SAMPLE_RATE = 24_000
#: 한국어 한 글자를 읽는 데 걸리는 대략의 시간
MS_PER_CHAR = 150
#: 어절 사이 쉼
GAP_MS = 60


def _silent_wav(duration_ms: int) -> bytes:
    frames = max(1, int(SAMPLE_RATE * duration_ms / 1000))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(SAMPLE_RATE)
        fh.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


class StubSynthesizer:
    name = "stub"
    default_voice = VoiceSpec(voice_id="stub-voice", model="stub", language="KOR")

    def synthesize(self, text: str, voice: VoiceSpec) -> TtsResult:
        tokens = text.split()
        words: list[WordTiming] = []
        cursor = 0
        for token in tokens:
            span = max(200, int(len(token) * MS_PER_CHAR / max(0.25, voice.speed)))
            words.append(WordTiming(text=token, start_ms=cursor, end_ms=cursor + span))
            cursor += span + GAP_MS

        duration = max(300, cursor)
        return TtsResult(
            provider=self.name,
            audio=_silent_wav(duration),
            audio_format="wav",
            duration_ms=duration,
            words=words,
            usd=0.0,
        )
