"""STT 공급자 인터페이스.

M1 비교 실험에서 하나를 고른다. 어느 쪽을 고르든 나머지 코드가 바뀌지 않도록
여기서 모양을 맞춘다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from ..transcript import Word


@dataclass
class TranscriptResult:
    engine: str
    words: list[Word]
    audio_seconds: float = 0.0
    wall_seconds: float = 0.0
    usd: float = 0.0
    #: 공급자가 문장 경계를 줄 때만 채워진다. 없으면 어미로 추정한다.
    sentence_bounds: list[tuple[int, int]] = field(default_factory=list)
    raw: dict | None = None

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def speed_ratio(self) -> float:
        """음성 길이 대비 처리 시간. 1보다 작으면 실시간보다 빠르다."""
        return self.wall_seconds / self.audio_seconds if self.audio_seconds else 0.0


class Transcriber(Protocol):
    name: str

    def transcribe(self, audio_path: Path, language: str = "ko") -> TranscriptResult: ...


class SttNotConfigured(RuntimeError):
    """키나 패키지가 없을 때. 무엇을 해야 하는지 알려 준다."""


def make_words(
    items: list[tuple[str, float, float]],
    speakers: list[str | None] | None = None,
    confidences: list[float | None] | None = None,
) -> list[Word]:
    """(텍스트, 시작초, 끝초) 목록 → Word 목록. 시간은 ms 정수로 바꾼다."""
    out: list[Word] = []
    for i, (text, start_s, end_s) in enumerate(items):
        out.append(
            Word(
                id=f"w{i}",
                text=text,
                start_ms=int(round(start_s * 1000)),
                end_ms=int(round(end_s * 1000)),
                speaker_id=speakers[i] if speakers and i < len(speakers) else None,
                confidence=confidences[i] if confidences and i < len(confidences) else None,
            )
        )
    return out
