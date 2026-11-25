"""하이라이트 파이프라인이 주고받는 타입.

LLM 출력 스키마(`*Out`)와 내부 타입을 분리한다.
LLM이 준 값은 전부 **검증 전 후보**로 다루고, validate 단계를 통과해야 쓴다.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

from pydantic import BaseModel, Field

# ── LLM 출력 스키마 (구조화 출력으로 강제) ──────────────────


class TopicOut(BaseModel):
    start_idx: int = Field(description="주제가 시작하는 단어 인덱스")
    end_idx: int = Field(description="주제가 끝나는 단어 인덱스 (포함)")
    topic: str = Field(description="이 구간이 무엇에 대한 이야기인지 한 줄")


class TopicsOut(BaseModel):
    topics: list[TopicOut]


class CandidateOut(BaseModel):
    start_idx: int
    end_idx: int
    why: str = Field(description="이 구간을 고른 이유 한 줄")


class CandidatesOut(BaseModel):
    candidates: list[CandidateOut]


class ScoreOut(BaseModel):
    index: int = Field(description="채점할 후보의 번호")
    hook: int = Field(ge=1, le=5, description="첫 3초가 사람을 붙잡는가")
    standalone: int = Field(ge=1, le=5, description="앞 맥락 없이 혼자 봐도 이해되는가")
    ending: int = Field(ge=1, le=5, description="결론·펀치라인에서 깔끔하게 끝나는가")
    value: int = Field(ge=1, le=5, description="웃기거나 유용하거나 놀랍거나 공감되는가")
    reason: str = Field(description="점수 근거 한 줄")


class ScoresOut(BaseModel):
    scores: list[ScoreOut]


class TitleOut(BaseModel):
    line1: str = Field(description="첫 줄: 꾸미는 말. 10~12자 이내")
    line2: str = Field(description="둘째 줄: 핵심. 10~12자 이내")
    keyword: str = Field(description="line2 안에서 색으로 강조할 연속된 부분. line2에 그대로 들어 있어야 한다")


class EffectOut(BaseModel):
    word_idx: int = Field(description="효과 글자를 띄울 기준 단어 인덱스")
    text: str = Field(description="의성어나 반응. 6자 이내", max_length=12)


class EnrichOut(BaseModel):
    titles: list[TitleOut] = Field(description="제목 후보 3개")
    summary: str = Field(description="한줄 요약. 30자 이내")
    question: str = Field(description="시청자에게 던질 질문 한 줄. 25자 이내")
    effects: list[EffectOut] = Field(default_factory=list, description="효과 글자. 없으면 빈 배열")


# ── 내부 타입 ──────────────────────────────────────────────


@dataclass(frozen=True)
class Topic:
    start_idx: int
    end_idx: int
    topic: str


@dataclass
class Candidate:
    start_idx: int
    end_idx: int
    why: str = ""
    topic: str = ""
    hook: int = 0
    standalone: int = 0
    ending: int = 0
    value: int = 0
    reason: str = ""
    titles: list[tuple[str, str, str]] = field(default_factory=list)
    """(line1, line2, keyword)"""
    summary: str = ""
    question: str = ""
    effects: list[tuple[int, str]] = field(default_factory=list)
    """(word_idx, text)"""

    @property
    def total(self) -> float:
        """가중 평균. 혼자 이해되는지와 후킹을 가장 무겁게 본다."""
        return round(
            (self.hook * 0.3 + self.standalone * 0.3 + self.ending * 0.2 + self.value * 0.2),
            2,
        )

    def moved(self, start_idx: int, end_idx: int) -> Candidate:
        return replace(self, start_idx=start_idx, end_idx=end_idx)


@dataclass(frozen=True)
class Rejection:
    candidate: Candidate
    rule: str
    detail: str
