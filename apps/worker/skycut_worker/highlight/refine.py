"""4단계: 구간 경계 다듬기.

LLM이 고른 대략의 구간을 문장 경계에 맞추고 앞뒤 군더더기를 걷어낸다.
**LLM을 쓰지 않으므로 결과가 항상 같고 테스트할 수 있다.**
"""
from __future__ import annotations

from ..korean import is_dangling_reference, is_filler, is_leading_connector, looks_like_sentence_end
from ..transcript import TranscriptView
from .types import Candidate

#: 앞에서 잘라낼 수 있는 어절 수 상한. 더 지우면 내용이 바뀔 수 있다.
MAX_TRIM = 4


def snap_to_sentences(view: TranscriptView, start_idx: int, end_idx: int) -> tuple[int, int]:
    """시작은 문장 시작으로, 끝은 문장 끝으로 맞춘다."""
    start = view.sentence_start_at_or_before(start_idx)
    end = view.sentence_end_at_or_after(end_idx)

    # 문장 정보가 없으면 어미로 추정한다
    if not view.sentences:
        start = _infer_sentence_start(view, start_idx)
        end = _infer_sentence_end(view, end_idx)

    return max(0, start), min(len(view) - 1, end)


def _infer_sentence_start(view: TranscriptView, idx: int) -> int:
    """앞으로 거슬러 올라가 문장이 끝난 바로 다음을 찾는다."""
    i = idx
    steps = 0
    while i > 0 and steps < 30:
        if looks_like_sentence_end(view.words[i - 1].text):
            return i
        i -= 1
        steps += 1
    return i


def _infer_sentence_end(view: TranscriptView, idx: int) -> int:
    i = idx
    steps = 0
    last = len(view) - 1
    while i < last and steps < 30:
        if looks_like_sentence_end(view.words[i].text):
            return i
        i += 1
        steps += 1
    return i


def trim_leading_noise(view: TranscriptView, start_idx: int, end_idx: int) -> int:
    """맨 앞의 말버릇과 접속어를 걷어낸다."""
    i = start_idx
    trimmed = 0
    while i < end_idx and trimmed < MAX_TRIM:
        token = view.words[i].text
        if is_filler(token) or is_leading_connector(token):
            i += 1
            trimmed += 1
            continue
        break
    return i


def trim_trailing_noise(view: TranscriptView, start_idx: int, end_idx: int) -> int:
    """맨 뒤의 말버릇을 걷어낸다. 문장 끝 어미는 남긴다."""
    i = end_idx
    trimmed = 0
    while i > start_idx and trimmed < MAX_TRIM:
        if is_filler(view.words[i].text):
            i -= 1
            trimmed += 1
            continue
        break
    return i


def starts_with_dangling_reference(view: TranscriptView, start_idx: int) -> bool:
    """'아까 그거'처럼 앞을 봐야 이해되는 말로 시작하는가."""
    return is_dangling_reference(view.words[start_idx].text)


def next_sentence_start(view: TranscriptView, idx: int) -> int | None:
    """idx 다음 문장의 시작. 없으면 None."""
    for s in view.sentences:
        if s.start_idx > idx:
            return s.start_idx
    # 문장 정보가 없으면 어미로 추정
    last = len(view) - 1
    for i in range(idx, min(last, idx + 40)):
        if looks_like_sentence_end(view.words[i].text) and i + 1 <= last:
            return i + 1
    return None


def refine(view: TranscriptView, cand: Candidate, min_ms: int, max_ms: int) -> Candidate:
    """한 후보의 경계를 다듬는다. 길이 조건은 여기서 맞추지 않고 validate가 판정한다."""
    start, end = snap_to_sentences(view, cand.start_idx, cand.end_idx)
    start = trim_leading_noise(view, start, end)
    end = trim_trailing_noise(view, start, end)

    # 지시어로 시작하면 다음 문장부터 시작해 본다
    if starts_with_dangling_reference(view, start):
        nxt = next_sentence_start(view, start)
        if nxt is not None and nxt < end and view.span_ms(nxt, end) >= min_ms:
            start = nxt

    # 너무 길면 뒤에서부터 문장 단위로 줄인다
    if view.span_ms(start, end) > max_ms:
        end = _shrink_to_max(view, start, end, max_ms)

    if end < start:
        end = start
    return cand.moved(start, end)


def _shrink_to_max(view: TranscriptView, start: int, end: int, max_ms: int) -> int:
    """끝을 앞으로 당겨 길이를 맞춘다. 문장 끝에서 멈춘다."""
    i = end
    while i > start and view.span_ms(start, i) > max_ms:
        i -= 1
    # 문장 중간에서 끊기지 않도록 앞쪽 문장 끝까지 더 당긴다
    j = i
    steps = 0
    while j > start and steps < 40:
        if view.is_sentence_end(j) or looks_like_sentence_end(view.words[j].text):
            return j
        j -= 1
        steps += 1
    return i
