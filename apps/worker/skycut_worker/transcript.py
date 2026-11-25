"""대본을 다루는 뷰.

LLM에게는 **단어 ID 대신 정수 인덱스**를 쓰게 한다.
ID는 LLM이 지어내기 쉽지만, 정수는 범위 검사만으로 걸러낼 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Word:
    id: str
    text: str
    start_ms: int
    end_ms: int
    speaker_id: str | None = None
    confidence: float | None = None


@dataclass(frozen=True)
class Sentence:
    id: str
    start_idx: int
    end_idx: int


@dataclass(frozen=True)
class Window:
    start_idx: int
    end_idx: int  # 포함


class TranscriptView:
    def __init__(self, words: list[Word], sentences: list[Sentence] | None = None) -> None:
        if not words:
            raise ValueError("대본이 비어 있습니다.")
        self.words = words
        self.sentences = sentences or []
        self._sentence_start = {s.start_idx for s in self.sentences}
        self._sentence_end = {s.end_idx for s in self.sentences}

    # ── 기본 ──────────────────────────────────────────────

    def __len__(self) -> int:
        return len(self.words)

    @property
    def duration_ms(self) -> int:
        return self.words[-1].end_ms - self.words[0].start_ms

    def span_ms(self, start_idx: int, end_idx: int) -> int:
        return self.words[end_idx].end_ms - self.words[start_idx].start_ms

    def text(self, start_idx: int, end_idx: int) -> str:
        return " ".join(w.text for w in self.words[start_idx : end_idx + 1])

    def in_range(self, idx: int) -> bool:
        return 0 <= idx < len(self.words)

    # ── 문장 경계 ─────────────────────────────────────────

    def is_sentence_start(self, idx: int) -> bool:
        return idx == 0 or idx in self._sentence_start

    def is_sentence_end(self, idx: int) -> bool:
        return idx == len(self.words) - 1 or idx in self._sentence_end

    def sentence_start_at_or_before(self, idx: int) -> int:
        for s in reversed(self.sentences):
            if s.start_idx <= idx <= s.end_idx:
                return s.start_idx
        return idx

    def sentence_end_at_or_after(self, idx: int) -> int:
        for s in self.sentences:
            if s.start_idx <= idx <= s.end_idx:
                return s.end_idx
        return idx

    # ── 창 나누기 ─────────────────────────────────────────

    def windows(self, size: int, overlap: int) -> list[Window]:
        """긴 영상을 겹치는 창으로 나눈다. 창 경계에서 하이라이트를 놓치지 않도록 겹친다."""
        n = len(self.words)
        if n <= size:
            return [Window(0, n - 1)]
        step = max(1, size - overlap)
        out: list[Window] = []
        start = 0
        while start < n:
            end = min(n - 1, start + size - 1)
            out.append(Window(start, end))
            if end == n - 1:
                break
            start += step
        return out

    # ── 프롬프트용 렌더링 ─────────────────────────────────

    def numbered(self, start_idx: int, end_idx: int, mark_sentences: bool = True) -> str:
        """`[12]단어` 형태로 렌더링한다. 문장 끝에는 ⏎를 붙여 경계를 보여 준다."""
        parts: list[str] = []
        for i in range(start_idx, end_idx + 1):
            w = self.words[i]
            parts.append(f"[{i}]{w.text}")
            if mark_sentences and self.is_sentence_end(i) and i != end_idx:
                parts.append("⏎")
        return " ".join(parts)

    def speaker_summary(self) -> str:
        speakers = {w.speaker_id for w in self.words if w.speaker_id}
        return f"화자 {len(speakers)}명" if speakers else "화자 정보 없음"
