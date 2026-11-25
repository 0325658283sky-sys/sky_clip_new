"""Project JSON 읽기·쓰기.

쓰기 전에 **생성된 Pydantic 스키마로 검증**한다. 워커가 스키마를 어기는
데이터를 만들어 내면 렌더러에서 터지는 대신 여기서 바로 잡힌다.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .autoedit import detect as detect_autoedit
from .comments import Comment
from .config import PROMPT_VERSION, ExtractionRequest, RunConfig
from .highlight.types import Candidate
from .korean import looks_like_sentence_end
from .schema_models import Project
from .transcript import Sentence, TranscriptView, Word

SCHEMA_VERSION = 1

#: 장르별 기본 테마. 정보형은 게시물 화이트, 나머지는 예능 블랙.
_INFO_GENRES = {"정보", "강의", "꿀팁", "뉴스", "리뷰"}


def pick_template(genre: str | None) -> str:
    return "b-white" if genre in _INFO_GENRES else "a-black"


# ── 읽기 ──────────────────────────────────────────────────


def load_project(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    Project.model_validate(raw)  # 들어오는 데이터도 믿지 않는다
    return raw


def view_from_project(project: dict[str, Any]) -> TranscriptView:
    transcript = project.get("transcript")
    if not transcript or not transcript.get("words"):
        raise ValueError(
            f"프로젝트 {project.get('id')}에 대본이 없습니다. transcribe 단계를 먼저 실행하세요."
        )

    words = [
        Word(
            id=w["id"],
            text=w["text"],
            start_ms=w["startMs"],
            end_ms=w["endMs"],
            speaker_id=w.get("speakerId"),
            confidence=w.get("confidence"),
        )
        for w in transcript["words"]
    ]
    index_of = {w.id: i for i, w in enumerate(words)}
    sentences = [
        Sentence(id=s["id"], start_idx=index_of[s["startWordId"]], end_idx=index_of[s["endWordId"]])
        for s in transcript.get("sentences", [])
        if s.get("startWordId") in index_of and s.get("endWordId") in index_of
    ]
    return TranscriptView(words, sentences)


def sentences_from_words(words: list[Word]) -> list[dict[str, str]]:
    """어미를 보고 문장 경계를 추정한다. STT가 문장을 주지 않을 때 쓴다."""
    out: list[dict[str, str]] = []
    start = 0
    for i, w in enumerate(words):
        last = i == len(words) - 1
        if looks_like_sentence_end(w.text) or last:
            out.append({"id": f"s{len(out)}", "startWordId": words[start].id, "endWordId": w.id})
            start = i + 1
    return out


# ── 쓰기 ──────────────────────────────────────────────────


def _keyword_span(line2: str, keyword: str) -> dict[str, int] | None:
    if not keyword:
        return None
    at = line2.find(keyword)
    if at < 0:
        return None
    return {"start": at, "end": at + len(keyword)}


def candidate_to_clip(
    view: TranscriptView,
    cand: Candidate,
    clip_id: str,
    template_id: str,
    credit: dict[str, str] | None,
    comment: Comment | None = None,
) -> dict[str, Any]:
    auto = detect_autoedit(view, cand.start_idx, cand.end_idx)

    titles: list[dict[str, Any]] = []
    for line1, line2, keyword in cand.titles[:5]:
        entry: dict[str, Any] = {"line1": line1[:40], "line2": line2[:40]}
        span = _keyword_span(entry["line2"], keyword)
        if span:
            entry["keywordSpan"] = span
        titles.append(entry)
    if not titles:
        # 제목 생성이 실패해도 클립 자체는 쓸 수 있게 둔다
        titles = [{"line1": "", "line2": view.text(cand.start_idx, min(cand.end_idx, cand.start_idx + 3))[:40]}]

    content: dict[str, Any] = {
        "kind": "video_excerpt",
        "range": {
            "startWordId": view.words[cand.start_idx].id,
            "endWordId": view.words[cand.end_idx].id,
        },
        "scenes": [],
        "titles": titles,
        "effectMoments": [
            {"anchorWordId": view.words[i].id, "text": text}
            for i, text in cand.effects
            if view.in_range(i)
        ],
        "autoEdit": {
            "fillerWordIds": auto.filler_word_ids,
            "silenceRangesMs": [{"startMs": a, "endMs": b} for a, b in auto.silence_ranges_ms],
        },
        "score": {
            "total": cand.total,
            "hook": cand.hook,
            "standalone": cand.standalone,
            "ending": cand.ending,
            "value": cand.value,
        },
        "reason": cand.reason[:300],
    }
    # 하단 카드는 실제 댓글이 있으면 그것을, 없으면 한줄 요약을 쓴다.
    # AI가 지어낸 문장을 댓글처럼 보여 주지 않는다.
    if comment:
        content["bottomCard"] = {
            "kind": "real_comment",
            "text": comment.text[:120],
            "authorMasked": comment.author_masked[:40],
        }
    elif cand.summary:
        content["bottomCard"] = {"kind": "summary", "text": cand.summary[:120]}
    if credit:
        content["credit"] = credit

    return {
        "id": clip_id,
        "content": content,
        "appliedTemplateId": template_id,
        "selectedTitleIndex": 0,
        "overrides": {
            "content": {"cuts": [], "keepWordIds": [], "captionText": {}, "extraEffectMoments": []},
            "style": {},
            "keepStyleOnTemplateChange": False,
        },
        "generated": [],
    }


def narrated_clip(
    short: Any,
    clip_id: str,
    template_id: str,
    credit: dict[str, str] | None,
) -> dict[str, Any]:
    """블로그 쇼츠 하나를 Clip으로 만든다 (`blog.pipeline.NarratedShort`).

    장면 길이는 TTS가 돌려준 **실제 길이**를 쓴다. 추정값을 쓰면 자막이 어긋난다.
    """
    script = short.script

    titles: list[dict[str, Any]] = []
    for line1, line2, keyword in script.titles[:5]:
        entry: dict[str, Any] = {"line1": line1[:40], "line2": line2[:40]}
        span = _keyword_span(entry["line2"], keyword)
        if span:
            entry["keywordSpan"] = span
        titles.append(entry)
    if not titles:
        titles = [{"line1": "", "line2": (script.scenes[0].narration if script.scenes else "")[:40]}]

    scenes: list[dict[str, Any]] = []
    generated: list[dict[str, Any]] = []
    for i, scene in enumerate(script.scenes):
        scene_id = short.scene_ids[i]
        entry = {"id": scene_id, "narration": scene.narration}
        if scene.image_url and getattr(scene, "image_asset_id", None):
            entry["imageAssetId"] = scene.image_asset_id
        if scene.text_card:
            entry["textCard"] = scene.text_card[:60]
        scenes.append(entry)

        generated.append(
            {
                "kind": "tts",
                "assetId": short.tts_asset_ids[i],
                "cacheKey": short.tts_asset_ids[i].removeprefix("tts-"),
                "sceneId": scene_id,
                "wordTimings": [
                    {"text": text, "startMs": start, "endMs": end}
                    for text, start, end in short.scene_word_timings[i]
                ],
                "durationMs": short.scene_durations_ms[i],
            }
        )

    content: dict[str, Any] = {
        "kind": "narrated_story",
        "scenes": scenes,
        "titles": titles,
        "effectMoments": [],
        "autoEdit": {"fillerWordIds": [], "silenceRangesMs": []},
        # 블로그 쇼츠는 사람이 고른 구간이 아니라 글 전체를 재구성한 것이라
        # 하이라이트 점수 체계를 그대로 쓰지 않고 중립값을 둔다.
        "score": {"total": 3.0, "hook": 3, "standalone": 3, "ending": 3, "value": 3},
        "reason": "블로그 글을 나레이션 쇼츠로 재구성",
    }
    if script.question:
        content["bottomCard"] = {"kind": "question", "text": script.question[:120]}
    if credit:
        content["credit"] = credit

    return {
        "id": clip_id,
        "content": content,
        "appliedTemplateId": template_id,
        "selectedTitleIndex": 0,
        "overrides": {
            "content": {"cuts": [], "keepWordIds": [], "captionText": {}, "extraEffectMoments": []},
            "style": {},
            "keepStyleOnTemplateChange": False,
        },
        "generated": generated,
        "narrationDurationMs": short.duration_ms,
    }


def attach_clips(
    project: dict[str, Any],
    view: TranscriptView,
    candidates: list[Candidate],
    cfg: RunConfig,
    stt_engine: str | None = None,
    *,
    credit: dict[str, str] | None = None,
    comments: list[Comment] | None = None,
) -> dict[str, Any]:
    """하이라이트 결과를 프로젝트에 붙이고 스키마로 검증한다."""
    template_id = pick_template(cfg.request.genre)
    pool = list(comments or [])

    project = dict(project)
    project["clips"] = [
        candidate_to_clip(
            view,
            cand,
            f"c{i + 1}",
            template_id,
            credit,
            # 클립마다 다른 댓글을 쓴다. 모자라면 한줄 요약으로 돌아간다.
            pool[i] if i < len(pool) else None,
        )
        for i, cand in enumerate(candidates)
    ]
    provenance = dict(project.get("provenance") or {})
    provenance["llmModel"] = "offline-stub" if cfg.offline else cfg.model
    provenance["promptVersion"] = PROMPT_VERSION
    if stt_engine:
        provenance["sttEngine"] = stt_engine
    project["provenance"] = provenance
    project.setdefault("schemaVersion", SCHEMA_VERSION)

    Project.model_validate(project)
    return project


def new_project(
    project_id: str,
    input_kind: str,
    url: str | None,
    rights_attested: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "id": project_id,
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "input": {
            "kind": input_kind,
            **({"url": url} if url else {}),
            "rightsAttested": rights_attested,
        },
        "assets": {},
        "clips": [],
        "provenance": {},
    }


def write_project(project: dict[str, Any], path: Path) -> None:
    Project.model_validate(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def request_from_project(project: dict[str, Any], fallback: ExtractionRequest) -> ExtractionRequest:
    """프로젝트에 사용자 추출 조건이 들어 있으면 그걸 쓴다."""
    req = project.get("extractionRequest")
    if not req:
        return fallback
    target = req.get("targetDurationSec") or []
    return ExtractionRequest(
        prompt=req.get("prompt") or fallback.prompt,
        min_duration_ms=int(target[0] * 1000) if len(target) == 2 else fallback.min_duration_ms,
        max_duration_ms=int(target[1] * 1000) if len(target) == 2 else fallback.max_duration_ms,
        genre=req.get("genre") or fallback.genre,
        max_clips=int(req.get("maxClips") or fallback.max_clips),
    )
