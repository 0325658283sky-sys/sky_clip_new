"""M1 오프라인 로직 검증.

LLM 없이 돌아가는 부분(경계 다듬기·검증·중복 제거·자동 편집)과
파이프라인 전체 흐름을 스텁으로 확인한다.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from skycut_worker.autoedit import detect
from skycut_worker.config import FIXTURES, ExtractionRequest, RunConfig, WindowConfig
from skycut_worker.highlight import StubLlm, extract_highlights, iou, refine, validate
from skycut_worker.highlight.types import Candidate
from skycut_worker.transcript import Sentence, TranscriptView, Word


def load_view(name: str) -> TranscriptView:
    raw = json.loads((Path(FIXTURES) / f"{name}.json").read_text(encoding="utf-8"))
    words = [
        Word(
            id=w["id"], text=w["text"], start_ms=w["startMs"], end_ms=w["endMs"],
            speaker_id=w.get("speakerId"), confidence=w.get("confidence"),
        )
        for w in raw["transcript"]["words"]
    ]
    index_of = {w.id: i for i, w in enumerate(words)}
    sentences = [
        Sentence(id=s["id"], start_idx=index_of[s["startWordId"]], end_idx=index_of[s["endWordId"]])
        for s in raw["transcript"].get("sentences", [])
        if s["startWordId"] in index_of and s["endWordId"] in index_of
    ]
    return TranscriptView(words, sentences)


@pytest.fixture
def ramen() -> TranscriptView:
    return load_view("fx-video-ramen")


@pytest.fixture
def variety() -> TranscriptView:
    return load_view("fx-video-variety")


# ── 경계 다듬기 ────────────────────────────────────────────


def test_접속어로_시작하면_잘라낸다(variety: TranscriptView) -> None:
    # "어 잠깐만요 어 그러니까 규칙에 ..." — 맨 앞 "어"가 사라져야 한다
    out = refine(variety, Candidate(0, 12), min_ms=1_000, max_ms=60_000)
    assert variety.words[out.start_idx].text != "어"


def test_너무_길면_끝을_당긴다(ramen: TranscriptView) -> None:
    full = Candidate(0, len(ramen) - 1)
    out = refine(ramen, full, min_ms=1_000, max_ms=5_000)
    assert ramen.span_ms(out.start_idx, out.end_idx) <= 5_000


def test_경계_다듬기는_항상_같은_결과(ramen: TranscriptView) -> None:
    c = Candidate(3, 20)
    a = refine(ramen, c, 1_000, 60_000)
    b = refine(ramen, c, 1_000, 60_000)
    assert (a.start_idx, a.end_idx) == (b.start_idx, b.end_idx)


# ── 검증 ──────────────────────────────────────────────────


def test_범위_밖_인덱스는_버린다(ramen: TranscriptView) -> None:
    kept, rejected = validate(ramen, [Candidate(0, 99_999)], 1_000, 60_000)
    assert kept == []
    assert rejected[0].rule == "index_bounds"


def test_짧으면_버린다(ramen: TranscriptView) -> None:
    kept, rejected = validate(ramen, [Candidate(0, 1)], 20_000, 60_000)
    assert kept == []
    assert rejected[0].rule == "too_short"


def test_지시어로_시작하면_버린다() -> None:
    words = [Word(id=f"w{i}", text=t, start_ms=i * 1000, end_ms=i * 1000 + 900)
             for i, t in enumerate(["아까", "그게", "진짜", "웃겼어요", "정말로"])]
    view = TranscriptView(words)
    kept, rejected = validate(view, [Candidate(0, 4)], 1_000, 60_000)
    assert kept == []
    assert rejected[0].rule == "dangling_start"


def test_겹치는_후보는_점수가_높은_쪽만_남는다(ramen: TranscriptView) -> None:
    low = Candidate(0, 20, hook=2, standalone=2, ending=2, value=2)
    high = Candidate(1, 21, hook=5, standalone=5, ending=5, value=5)
    assert iou(low, high) > 0.35
    kept, rejected = validate(ramen, [low, high], 1_000, 120_000)
    assert len(kept) == 1
    assert kept[0].total == high.total
    assert rejected[0].rule == "duplicate"


# ── 자동 편집 ─────────────────────────────────────────────


def test_말버릇을_찾아낸다(variety: TranscriptView) -> None:
    result = detect(variety, 0, len(variety) - 1)
    found = {variety.words[i].id for i in range(len(variety)) if variety.words[i].text in {"어", "음"}}
    assert set(result.filler_word_ids) & found


def test_자동편집은_후보만_만든다(variety: TranscriptView) -> None:
    """실제 삭제는 resolve()가 한다. 여기서는 대본을 건드리지 않는다."""
    before = [w.text for w in variety.words]
    detect(variety, 0, len(variety) - 1)
    assert [w.text for w in variety.words] == before


# ── 파이프라인 (스텁) ─────────────────────────────────────


@pytest.fixture
def cfg() -> RunConfig:
    return RunConfig(
        request=ExtractionRequest(min_duration_ms=5_000, max_duration_ms=40_000, max_clips=3),
        window=WindowConfig(size=40, overlap=8),
        offline=True,
    )


def test_파이프라인이_끝까지_돈다(ramen: TranscriptView, cfg: RunConfig) -> None:
    result = extract_highlights(ramen, StubLlm(ramen), cfg)
    assert result.clips, "후보가 하나도 남지 않았습니다"
    assert len(result.clips) <= cfg.request.max_clips


def test_결과_구간이_모두_유효하다(ramen: TranscriptView, cfg: RunConfig) -> None:
    result = extract_highlights(ramen, StubLlm(ramen), cfg)
    for c in result.clips:
        assert 0 <= c.start_idx <= c.end_idx < len(ramen)
        span = ramen.span_ms(c.start_idx, c.end_idx)
        assert cfg.request.min_duration_ms <= span <= cfg.request.max_duration_ms

    # 서로 겹치지 않는다
    ordered = sorted(result.clips, key=lambda c: c.start_idx)
    for a, b in zip(ordered, ordered[1:]):
        assert iou(a, b) < 0.35


def test_제목은_두_줄이고_키워드가_둘째_줄에_있다(ramen: TranscriptView, cfg: RunConfig) -> None:
    result = extract_highlights(ramen, StubLlm(ramen), cfg)
    for c in result.clips:
        assert c.titles, "제목 후보가 없습니다"
        for line1, line2, keyword in c.titles:
            assert line1 and line2
            if keyword:
                assert keyword in line2


def test_파이프라인은_항상_같은_결과(ramen: TranscriptView, cfg: RunConfig) -> None:
    a = extract_highlights(ramen, StubLlm(ramen), cfg)
    b = extract_highlights(ramen, StubLlm(ramen), cfg)
    assert [(c.start_idx, c.end_idx, c.total) for c in a.clips] == [
        (c.start_idx, c.end_idx, c.total) for c in b.clips
    ]
