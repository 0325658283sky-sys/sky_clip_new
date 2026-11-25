"""군더더기 말과 무음 구간 **후보** 찾기.

후보만 만든다. 실제로 지울지는 템플릿 규칙과 사용자 편집이 정하고,
그 판단은 렌더 시점의 resolve()가 한다 (ARCHITECTURE.md 규칙 1).

LLM을 쓰지 않으므로 결과가 항상 같다.
"""
from __future__ import annotations

from dataclasses import dataclass

from .korean import is_filler
from .transcript import TranscriptView

#: 이보다 긴 말 없는 구간을 무음 후보로 본다
SILENCE_MIN_MS = 500

#: 신뢰도가 이보다 낮으면서 말버릇이면 더 확실히 군더더기로 본다
LOW_CONFIDENCE = 0.5


@dataclass
class AutoEdit:
    filler_word_ids: list[str]
    silence_ranges_ms: list[tuple[int, int]]


def detect(view: TranscriptView, start_idx: int, end_idx: int) -> AutoEdit:
    fillers: list[str] = []
    silences: list[tuple[int, int]] = []

    for i in range(start_idx, end_idx + 1):
        w = view.words[i]
        if not is_filler(w.text):
            continue
        # 문장 안에서 뜻을 지는 단어일 수 있으므로, 홀로 떠 있는 경우만 고른다.
        # 앞뒤가 모두 말버릇이 아니고 자기 자신만 말버릇이면 안전하게 지울 수 있다.
        if _is_safe_to_drop(view, i, start_idx, end_idx):
            fillers.append(w.id)

    for i in range(start_idx, end_idx):
        gap = view.words[i + 1].start_ms - view.words[i].end_ms
        if gap >= SILENCE_MIN_MS:
            silences.append((view.words[i].end_ms, view.words[i + 1].start_ms))

    return AutoEdit(filler_word_ids=fillers, silence_ranges_ms=silences)


def _is_safe_to_drop(view: TranscriptView, idx: int, start_idx: int, end_idx: int) -> bool:
    """지워도 문장이 깨지지 않는 자리인지 본다. 애매하면 남긴다(정밀도 우선)."""
    w = view.words[idx]

    # 구간의 처음이나 끝에 붙은 말버릇은 안전하다
    if idx == start_idx or idx == end_idx:
        return True

    # 신뢰도가 낮으면 잘못 받아쓴 소리일 가능성이 높다
    if w.confidence is not None and w.confidence < LOW_CONFIDENCE:
        return True

    # "어" 하고 쉬었다가 이어지는 경우 — 앞뒤에 빈 시간이 있으면 말버릇으로 본다
    before_gap = w.start_ms - view.words[idx - 1].end_ms
    after_gap = view.words[idx + 1].start_ms - w.end_ms
    if before_gap >= 150 or after_gap >= 150:
        return True

    # 한 글자 말버릇은 붙여 읽히면 뜻을 가질 수 있다 (예: "그 사람")
    return len(w.text) > 1
