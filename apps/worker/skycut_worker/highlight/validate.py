"""5단계: 검증.

LLM이 준 값은 전부 의심한다. 여기를 통과하지 못한 후보는 버린다.
**M1 Gate: 단어 인덱스·길이·겹침 검증 100% 통과**
"""
from __future__ import annotations

from ..korean import strip_particles
from ..transcript import TranscriptView
from .refine import starts_with_dangling_reference
from .types import Candidate, Rejection

#: 두 구간이 이만큼 겹치면 같은 내용으로 본다
OVERLAP_IOU = 0.25
#: 짧은 쪽 기준으로 이만큼 겹치면 중복으로 본다.
#: IoU만 보면 길이가 다른 두 구간이 크게 겹쳐도 통과한다 (긴 쪽이 분모를 키우기 때문).
#: 경계를 문장에 맞추는 과정에서 구간이 서로 번지는 경우를 여기서 잡는다.
OVERLAP_CONTAINMENT = 0.20
#: 어절이 이만큼 같으면 중복으로 본다
TEXT_SIMILARITY = 0.6


def check_one(
    view: TranscriptView,
    cand: Candidate,
    min_ms: int,
    max_ms: int,
) -> Rejection | None:
    """한 후보가 규칙을 지키는지 본다. 통과하면 None."""
    n = len(view)

    if not view.in_range(cand.start_idx) or not view.in_range(cand.end_idx):
        return Rejection(cand, "index_bounds", f"인덱스가 범위를 벗어남 (0~{n - 1})")

    if cand.end_idx < cand.start_idx:
        return Rejection(cand, "reversed", "끝이 시작보다 앞")

    span = view.span_ms(cand.start_idx, cand.end_idx)
    if span < min_ms:
        return Rejection(cand, "too_short", f"{span / 1000:.1f}초 < {min_ms / 1000:.0f}초")
    if span > max_ms:
        return Rejection(cand, "too_long", f"{span / 1000:.1f}초 > {max_ms / 1000:.0f}초")

    if starts_with_dangling_reference(view, cand.start_idx):
        return Rejection(cand, "dangling_start", f"'{view.words[cand.start_idx].text}'로 시작해 혼자 보면 이해되지 않음")

    return None


def _intersection(a: Candidate, b: Candidate) -> int:
    return max(0, min(a.end_idx, b.end_idx) - max(a.start_idx, b.start_idx) + 1)


def iou(a: Candidate, b: Candidate) -> float:
    inter = _intersection(a, b)
    union = (a.end_idx - a.start_idx + 1) + (b.end_idx - b.start_idx + 1) - inter
    return inter / union if union else 0.0


def containment(a: Candidate, b: Candidate) -> float:
    """짧은 쪽이 얼마나 먹혔는지. 길이가 많이 다른 두 구간의 겹침을 잡는다."""
    inter = _intersection(a, b)
    shorter = min(a.end_idx - a.start_idx + 1, b.end_idx - b.start_idx + 1)
    return inter / shorter if shorter else 0.0


def overlaps(a: Candidate, b: Candidate) -> bool:
    return iou(a, b) >= OVERLAP_IOU or containment(a, b) >= OVERLAP_CONTAINMENT


def text_similarity(view: TranscriptView, a: Candidate, b: Candidate) -> float:
    """어간 집합의 자카드 유사도. 다른 위치에서 같은 말을 한 경우를 잡는다."""
    sa = {strip_particles(w.text) for w in view.words[a.start_idx : a.end_idx + 1]}
    sb = {strip_particles(w.text) for w in view.words[b.start_idx : b.end_idx + 1]}
    sa.discard("")
    sb.discard("")
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def filter_by_rules(
    view: TranscriptView,
    candidates: list[Candidate],
    min_ms: int,
    max_ms: int,
) -> tuple[list[Candidate], list[Rejection]]:
    """규칙 검사만. 채점 전에 돌려 비용을 아낀다."""
    kept: list[Candidate] = []
    rejected: list[Rejection] = []
    for cand in candidates:
        bad = check_one(view, cand, min_ms, max_ms)
        (rejected.append(bad) if bad else kept.append(cand))
    return kept, rejected


def deduplicate(
    view: TranscriptView,
    candidates: list[Candidate],
) -> tuple[list[Candidate], list[Rejection]]:
    """겹치거나 같은 내용인 후보를 정리한다. 점수가 높은 쪽을 남긴다."""
    ordered = sorted(candidates, key=lambda c: (-c.total, -(c.end_idx - c.start_idx), c.start_idx))
    accepted: list[Candidate] = []
    rejected: list[Rejection] = []

    for cand in ordered:
        clash = next(
            (
                a
                for a in accepted
                if overlaps(cand, a) or text_similarity(view, cand, a) >= TEXT_SIMILARITY
            ),
            None,
        )
        if clash:
            rejected.append(
                Rejection(cand, "duplicate", f"[{clash.start_idx}-{clash.end_idx}] 구간과 내용이 겹침")
            )
            continue
        accepted.append(cand)

    accepted.sort(key=lambda c: c.start_idx)
    return accepted, rejected


def validate(
    view: TranscriptView,
    candidates: list[Candidate],
    min_ms: int,
    max_ms: int,
) -> tuple[list[Candidate], list[Rejection]]:
    """규칙 검사 + 중복 정리를 한 번에."""
    kept, rejected = filter_by_rules(view, candidates, min_ms, max_ms)
    accepted, dupes = deduplicate(view, kept)
    return accepted, rejected + dupes
