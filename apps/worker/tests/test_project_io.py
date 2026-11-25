"""워커가 만든 Project JSON이 스키마를 지키는지, 렌더러가 쓸 모양인지 본다."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from skycut_worker.config import FIXTURES, ExtractionRequest, RunConfig, WindowConfig
from skycut_worker.highlight import StubLlm, extract_highlights
from skycut_worker.highlight.types import Candidate
from skycut_worker.project_io import (
    attach_clips,
    candidate_to_clip,
    load_project,
    pick_template,
    sentences_from_words,
    view_from_project,
)
from skycut_worker.schema_models import Project
from skycut_worker.transcript import TranscriptView, Word


@pytest.fixture
def project() -> dict:
    return load_project(Path(FIXTURES) / "fx-video-ramen.json")


@pytest.fixture
def view(project: dict) -> TranscriptView:
    return view_from_project(project)


@pytest.fixture
def cfg() -> RunConfig:
    return RunConfig(
        request=ExtractionRequest(min_duration_ms=5_000, max_duration_ms=40_000, max_clips=3),
        window=WindowConfig(size=40, overlap=8),
        offline=True,
    )


def test_장르로_테마를_고른다() -> None:
    assert pick_template("정보") == "b-white"
    assert pick_template("예능") == "a-black"
    assert pick_template(None) == "a-black"


def test_대본이_없으면_친절한_오류() -> None:
    with pytest.raises(ValueError, match="대본이 없습니다"):
        view_from_project({"id": "x", "clips": []})


def test_문장_경계를_어미로_추정한다() -> None:
    words = [
        Word(id=f"w{i}", text=t, start_ms=i * 500, end_ms=i * 500 + 400)
        for i, t in enumerate(["이건", "사실입니다", "그리고", "저건", "거짓이에요"])
    ]
    out = sentences_from_words(words)
    assert len(out) == 2
    assert out[0]["endWordId"] == "w1"
    assert out[1]["endWordId"] == "w4"


def test_클립이_스키마를_통과한다(view: TranscriptView, project: dict, cfg: RunConfig) -> None:
    result = extract_highlights(view, StubLlm(view), cfg)
    updated = attach_clips(project, view, result.clips, cfg, stt_engine="fixture")
    Project.model_validate(updated)  # 여기서 터지면 렌더러도 못 읽는다
    assert updated["clips"]
    assert updated["provenance"]["sttEngine"] == "fixture"
    assert updated["provenance"]["llmModel"] == "offline-stub"


def test_구간은_실제_단어_ID를_가리킨다(view: TranscriptView, project: dict, cfg: RunConfig) -> None:
    result = extract_highlights(view, StubLlm(view), cfg)
    updated = attach_clips(project, view, result.clips, cfg)
    ids = {w.id for w in view.words}
    for clip in updated["clips"]:
        rng = clip["content"]["range"]
        assert rng["startWordId"] in ids
        assert rng["endWordId"] in ids


def test_키워드가_둘째_줄에_없으면_강조를_넣지_않는다(view: TranscriptView) -> None:
    cand = Candidate(0, 10, titles=[("첫 줄", "둘째 줄", "없는말")])
    clip = candidate_to_clip(view, cand, "c1", "a-black", None)
    assert "keywordSpan" not in clip["content"]["titles"][0]


def test_키워드_위치를_정확히_잡는다(view: TranscriptView) -> None:
    cand = Candidate(0, 10, titles=[("첫 줄", "라면 황금 비율", "황금")])
    clip = candidate_to_clip(view, cand, "c1", "a-black", None)
    span = clip["content"]["titles"][0]["keywordSpan"]
    assert "라면 황금 비율"[span["start"] : span["end"]] == "황금"


def test_쓰기는_검증을_거친다(view: TranscriptView, project: dict, cfg: RunConfig, tmp_path: Path) -> None:
    from skycut_worker.project_io import write_project

    result = extract_highlights(view, StubLlm(view), cfg)
    updated = attach_clips(project, view, result.clips, cfg)
    out = tmp_path / "p.json"
    write_project(updated, out)
    Project.model_validate(json.loads(out.read_text(encoding="utf-8")))
