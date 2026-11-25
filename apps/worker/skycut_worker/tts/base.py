"""TTS 공급자 인터페이스.

자막을 음성에 맞추려면 **단어별 시간**이 필요하다. 공급자마다 주는 모양이
달라서 여기서 하나로 맞춘다.

  - Typecast: 단어 단위를 그대로 준다 (한국어 KOR 지원 확인됨)
  - ElevenLabs: 글자 단위만 준다 → 공백으로 묶어 단어로 만든다
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class WordTiming:
    text: str
    start_ms: int
    end_ms: int


@dataclass
class TtsResult:
    provider: str
    audio: bytes
    audio_format: str
    """wav | mp3"""
    duration_ms: int
    words: list[WordTiming] = field(default_factory=list)
    usd: float = 0.0
    wall_seconds: float = 0.0

    @property
    def extension(self) -> str:
        return "mp3" if self.audio_format == "mp3" else "wav"


@dataclass(frozen=True)
class VoiceSpec:
    """같은 대본이라도 이 값이 바뀌면 다시 만들어야 한다."""

    voice_id: str
    model: str
    speed: float = 1.0
    language: str = "KOR"

    def cache_key(self, text: str, provider: str) -> str:
        digest = hashlib.sha256()
        for part in (provider, self.voice_id, self.model, f"{self.speed:.3f}", self.language, text):
            digest.update(part.encode("utf-8"))
            digest.update(b"\x00")
        return digest.hexdigest()[:20]


class Synthesizer(Protocol):
    name: str
    default_voice: VoiceSpec

    def synthesize(self, text: str, voice: VoiceSpec) -> TtsResult: ...


class TtsNotConfigured(RuntimeError):
    """키나 설정이 없을 때. 무엇을 해야 하는지 알려 준다."""


def group_characters_into_words(
    characters: list[str],
    start_seconds: list[float],
    end_seconds: list[float],
) -> list[WordTiming]:
    """글자 단위 타임스탬프를 어절로 묶는다 (ElevenLabs용).

    공백을 경계로 보고, 각 어절의 시작은 첫 글자, 끝은 마지막 글자에서 가져온다.
    """
    words: list[WordTiming] = []
    buffer: list[str] = []
    started: float | None = None
    ended: float = 0.0

    def flush() -> None:
        nonlocal buffer, started
        if buffer and started is not None:
            text = "".join(buffer).strip()
            if text:
                words.append(
                    WordTiming(text=text, start_ms=int(round(started * 1000)), end_ms=int(round(ended * 1000)))
                )
        buffer = []
        started = None

    for i, char in enumerate(characters):
        if i >= len(start_seconds) or i >= len(end_seconds):
            break
        if char.isspace():
            flush()
            continue
        if started is None:
            started = start_seconds[i]
        buffer.append(char)
        ended = end_seconds[i]
    flush()
    return words


def spread_words(text: str, duration_ms: int, ms_per_char: int = 120) -> list[WordTiming]:
    """시간 정보가 없을 때 글자 수에 비례해 나눈다. 최후의 수단이다."""
    tokens = text.split()
    if not tokens:
        return []
    total_chars = sum(len(t) for t in tokens) or 1
    out: list[WordTiming] = []
    cursor = 0
    for token in tokens:
        span = max(120, round(duration_ms * len(token) / total_chars)) if duration_ms else len(token) * ms_per_char
        out.append(WordTiming(text=token, start_ms=cursor, end_ms=min(cursor + span, duration_ms or cursor + span)))
        cursor += span
    return out
