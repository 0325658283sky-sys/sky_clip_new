"""오프라인 스텁 LLM.

API 키 없이 파이프라인 전체(창 나누기 → 검증 → 선택 → 조립)를 돌려 보기 위한 것.
**같은 입력에 항상 같은 결과**를 내므로 테스트에 쓸 수 있다.

실제 LLM과 같은 `LlmClient` 인터페이스를 쓰므로, 오프라인 실행도
파이프라인의 진짜 코드 경로를 지난다. 프롬프트 문자열에서 인덱스를
되읽어 쓴다.
"""
from __future__ import annotations

import re
from typing import TypeVar

from pydantic import BaseModel

from ..transcript import TranscriptView
from .types import (
    CandidateOut,
    CandidatesOut,
    EffectOut,
    EnrichOut,
    ScoreOut,
    ScoresOut,
    TitleOut,
    TopicOut,
    TopicsOut,
)

T = TypeVar("T", bound=BaseModel)

_IDX_RE = re.compile(r"\[(\d+)\]")
_CAND_RE = re.compile(r"\[후보 (\d+)\]")


class StubLlm:
    """결정적인 가짜 응답. 실제 품질을 흉내 내지 않는다."""

    def __init__(self, view: TranscriptView, topics_per_window: int = 2, candidates_per_topic: int = 2) -> None:
        self._view = view
        self._topics_per_window = topics_per_window
        self._candidates_per_topic = candidates_per_topic

    def structured(self, step: str, system: str, user: str, output_format: type[T]) -> T:
        indices = [int(m) for m in _IDX_RE.findall(user)]

        if output_format is TopicsOut:
            return self._topics(indices)  # type: ignore[return-value]
        if output_format is CandidatesOut:
            return self._candidates(indices)  # type: ignore[return-value]
        if output_format is ScoresOut:
            return self._scores(user)  # type: ignore[return-value]
        if output_format is EnrichOut:
            return self._enrich(indices)  # type: ignore[return-value]
        raise NotImplementedError(f"스텁이 모르는 출력 형식: {output_format!r}")

    # ──────────────────────────────────────────────────────

    def _topics(self, indices: list[int]) -> TopicsOut:
        if not indices:
            return TopicsOut(topics=[])
        n = self._topics_per_window
        size = max(1, len(indices) // n)
        out: list[TopicOut] = []
        for k in range(n):
            lo = indices[k * size]
            hi = indices[min(len(indices) - 1, (k + 1) * size - 1)] if k < n - 1 else indices[-1]
            if hi < lo:
                continue
            out.append(TopicOut(start_idx=lo, end_idx=hi, topic=f"스텁 주제 {k + 1}"))
        return TopicsOut(topics=out)

    def _candidates(self, indices: list[int]) -> CandidatesOut:
        """목표 길이에 맞춰 구간을 잘라 낸다 (시간 기준)."""
        if not indices:
            return CandidatesOut(candidates=[])
        lo, hi = indices[0], indices[-1]
        target_ms = 35_000
        out: list[CandidateOut] = []
        cursor = lo
        while cursor < hi and len(out) < self._candidates_per_topic:
            end = cursor
            while end < hi and self._view.span_ms(cursor, end) < target_ms:
                end += 1
            out.append(CandidateOut(start_idx=cursor, end_idx=end, why="스텁 후보"))
            cursor = end + 1
        return CandidatesOut(candidates=out)

    def _scores(self, user: str) -> ScoresOut:
        nums = [int(m) for m in _CAND_RE.findall(user)]
        return ScoresOut(
            scores=[
                ScoreOut(
                    index=i,
                    # 결정적이되 후보마다 다르게
                    hook=3 + (i % 3) // 2,
                    standalone=3 + (i + 1) % 2,
                    ending=3,
                    value=3 + (i % 2),
                    reason="스텁 채점",
                )
                for i in nums
            ]
        )

    def _enrich(self, indices: list[int]) -> EnrichOut:
        if not indices:
            return EnrichOut(titles=[], summary="", question="", effects=[])
        lo, hi = indices[0], indices[-1]
        words = [w.text for w in self._view.words[lo : hi + 1]]
        head = " ".join(words[:3])[:12] or "스텁"
        key = (words[0] if words else "스텁")[:6]
        return EnrichOut(
            titles=[
                TitleOut(line1="스텁 제목", line2=f"{key} 이야기", keyword=key),
                TitleOut(line1="두 번째 안", line2=f"{key} 정리", keyword=key),
                TitleOut(line1="세 번째 안", line2=f"{key} 요약", keyword=key),
            ],
            summary=f"{head} 구간 요약",
            question="여러분은 어떠세요?",
            effects=[EffectOut(word_idx=lo + min(3, hi - lo), text="ㅋㅋㅋ")] if hi - lo > 4 else [],
        )
