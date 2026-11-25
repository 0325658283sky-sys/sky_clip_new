"""하이라이트 추출 파이프라인.

    주제 나누기 → 후보 찾기 → 경계 다듬기 → 검증 → 채점 → 선택 → 부가 정보

LLM을 쓰는 단계와 쓰지 않는 단계를 분리했다. 검증·경계 다듬기·선택은
LLM 없이 돌아가므로 결과가 항상 같고 테스트할 수 있다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ..config import ExtractionRequest, RunConfig
from ..transcript import TranscriptView
from . import prompts
from .llm import LlmClient
from .refine import refine
from .types import (
    Candidate,
    CandidatesOut,
    EnrichOut,
    Rejection,
    ScoresOut,
    Topic,
    TopicsOut,
)
from .validate import deduplicate, filter_by_rules

#: 한 번에 채점할 후보 수
SCORE_BATCH = 8


@dataclass
class HighlightResult:
    topics: list[Topic] = field(default_factory=list)
    clips: list[Candidate] = field(default_factory=list)
    rejected: list[Rejection] = field(default_factory=list)

    def report(self) -> str:
        lines = [f"주제 {len(self.topics)}개 · 최종 {len(self.clips)}개 · 버린 후보 {len(self.rejected)}개"]
        for c in self.clips:
            title = c.titles[0] if c.titles else ("", "", "")
            lines.append(f"  [{c.start_idx:>5}-{c.end_idx:<5}] {c.total:.2f}점  {title[0]} {title[1]}")
        by_rule: dict[str, int] = {}
        for r in self.rejected:
            by_rule[r.rule] = by_rule.get(r.rule, 0) + 1
        if by_rule:
            lines.append("  버린 이유: " + ", ".join(f"{k} {v}개" for k, v in sorted(by_rule.items())))
        return "\n".join(lines)


def extract_highlights(view: TranscriptView, llm: LlmClient, cfg: RunConfig) -> HighlightResult:
    req = cfg.request

    topics = _segment(view, llm, cfg)
    raw = _find_candidates(view, llm, topics, req)

    # ── 여기부터는 LLM 없이 ──
    refined = [refine(view, c, req.min_duration_ms, req.max_duration_ms) for c in raw]
    passed, rejected = filter_by_rules(view, refined, req.min_duration_ms, req.max_duration_ms)

    # 채점 전에 명백한 중복을 걷어내 비용을 아낀다
    pre, pre_rejected = deduplicate(view, passed)
    rejected += pre_rejected

    scored = _score(view, llm, pre)

    final, dupes = deduplicate(view, scored)
    rejected += dupes

    final.sort(key=lambda c: (-c.total, c.start_idx))
    selected = final[: req.max_clips]
    for leftover in final[req.max_clips :]:
        rejected.append(Rejection(leftover, "not_selected", f"상위 {req.max_clips}개에 들지 못함"))

    for cand in selected:
        _enrich(view, llm, cand, req)

    selected.sort(key=lambda c: c.start_idx)
    return HighlightResult(topics=topics, clips=selected, rejected=rejected)


# ── 1단계 ──────────────────────────────────────────────────


def _segment(view: TranscriptView, llm: LlmClient, cfg: RunConfig) -> list[Topic]:
    topics: list[Topic] = []
    for win in view.windows(cfg.window.size, cfg.window.overlap):
        out = llm.structured(
            "segment",
            prompts.SEGMENT_SYSTEM,
            prompts.segment_user(view.numbered(win.start_idx, win.end_idx), view.speaker_summary()),
            TopicsOut,
        )
        for t in out.topics:
            lo = max(win.start_idx, min(t.start_idx, win.end_idx))
            hi = max(win.start_idx, min(t.end_idx, win.end_idx))
            if hi <= lo:
                continue  # 지어낸 범위는 버린다
            topics.append(Topic(start_idx=lo, end_idx=hi, topic=t.topic.strip()))

    if not topics:
        return [Topic(0, len(view) - 1, "전체")]

    # 창이 겹치므로 같은 자리의 주제가 두 번 나올 수 있다
    topics.sort(key=lambda t: (t.start_idx, -t.end_idx))
    merged: list[Topic] = []
    for t in topics:
        if merged and t.start_idx <= merged[-1].end_idx:
            prev = merged[-1]
            if t.end_idx > prev.end_idx:
                merged[-1] = Topic(prev.start_idx, t.end_idx, prev.topic)
            continue
        merged.append(t)
    return merged


# ── 2단계 ──────────────────────────────────────────────────


def _find_candidates(
    view: TranscriptView, llm: LlmClient, topics: list[Topic], req: ExtractionRequest
) -> list[Candidate]:
    out: list[Candidate] = []
    for topic in topics:
        result = llm.structured(
            "candidates",
            prompts.CANDIDATES_SYSTEM,
            prompts.candidates_user(view.numbered(topic.start_idx, topic.end_idx), topic.topic, req),
            CandidatesOut,
        )
        for c in result.candidates:
            if not view.in_range(c.start_idx) or not view.in_range(c.end_idx):
                continue  # 범위 밖 인덱스는 여기서 바로 버린다
            out.append(
                Candidate(
                    start_idx=min(c.start_idx, c.end_idx),
                    end_idx=max(c.start_idx, c.end_idx),
                    why=c.why.strip(),
                    topic=topic.topic,
                )
            )
    return out


# ── 3단계 ──────────────────────────────────────────────────


def _score(view: TranscriptView, llm: LlmClient, candidates: list[Candidate]) -> list[Candidate]:
    if not candidates:
        return []
    for offset in range(0, len(candidates), SCORE_BATCH):
        batch = candidates[offset : offset + SCORE_BATCH]
        blocks = [
            prompts.score_block(
                offset + i,
                view.text(c.start_idx, c.end_idx),
                view.span_ms(c.start_idx, c.end_idx) / 1000,
                c.why,
            )
            for i, c in enumerate(batch)
        ]
        out = llm.structured("score", prompts.SCORE_SYSTEM, prompts.score_user(blocks), ScoresOut)
        got = {s.index: s for s in out.scores}
        for i, c in enumerate(batch):
            s = got.get(offset + i)
            if s is None:
                # 채점이 빠진 후보는 보통으로 둔다. 버리지는 않는다.
                c.hook = c.standalone = c.ending = c.value = 3
                c.reason = "채점 누락 — 기본값"
                continue
            c.hook, c.standalone, c.ending, c.value = s.hook, s.standalone, s.ending, s.value
            c.reason = s.reason.strip()
    return candidates


# ── 4단계 ──────────────────────────────────────────────────


def _enrich(view: TranscriptView, llm: LlmClient, cand: Candidate, req: ExtractionRequest) -> None:
    out: EnrichOut = llm.structured(
        "enrich",
        prompts.ENRICH_SYSTEM,
        prompts.enrich_user(view.numbered(cand.start_idx, cand.end_idx), cand.start_idx, cand.end_idx, req.genre),
        EnrichOut,
    )

    titles: list[tuple[str, str, str]] = []
    for t in out.titles[:3]:
        line1, line2 = t.line1.strip(), t.line2.strip()
        keyword = t.keyword.strip()
        # 강조할 키워드가 둘째 줄에 실제로 들어 있어야 색을 칠할 수 있다
        if keyword and keyword not in line2:
            keyword = ""
        titles.append((line1, line2, keyword))
    if titles:
        cand.titles = titles

    cand.summary = out.summary.strip()
    cand.question = out.question.strip()
    cand.effects = [
        (e.word_idx, e.text.strip())
        for e in out.effects
        if cand.start_idx <= e.word_idx <= cand.end_idx and e.text.strip()
    ][:2]
