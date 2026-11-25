"""입력 하나로 쇼츠 설계까지 — M2 전체 연결.

    유튜브 URL / MP4
      → 에셋 (1080p 원본, 480p 프록시, 16kHz wav, 파형, 썸네일)
      → 대본
      → 하이라이트 클립이 든 Project JSON

단계마다 걸린 시간을 재서 M2 Gate(10분 영상 3분 이내)를 확인할 수 있게 한다.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import project_io
from .comments import Comment, CommentsUnavailable, fetch_top_comments
from .config import RunConfig
from .cost import CostReport, SttUsage
from .highlight import StubLlm, extract_highlights
from .highlight.llm import AnthropicLlm, LlmClient
from .media import MediaStore, ingest, video_id_from_url
from .media.store import META
from .stt import get_transcriber
from .transcript import TranscriptView

Progress = Callable[[str], None]


@dataclass
class Stage:
    name: str
    seconds: float


@dataclass
class RunResult:
    project: dict[str, Any]
    project_path: Path | None = None
    stages: list[Stage] = field(default_factory=list)
    cost: CostReport | None = None
    media_seconds: float = 0.0
    clips: int = 0

    @property
    def total_seconds(self) -> float:
        return sum(s.seconds for s in self.stages)

    def summary(self) -> str:
        lines = [f"클립 {self.clips}개 · 전체 {self.total_seconds:.0f}초"]
        for s in self.stages:
            lines.append(f"  {s.name:<12} {s.seconds:>6.1f}초")
        if self.media_seconds:
            ratio = self.total_seconds / self.media_seconds
            lines.append(f"  영상 길이 대비 {ratio:.2f}배 (영상 {self.media_seconds / 60:.1f}분)")
        return "\n".join(lines)


def _llm(view: TranscriptView, cfg: RunConfig, report: CostReport) -> LlmClient:
    return StubLlm(view) if cfg.offline else AnthropicLlm(cfg, report)


def run_pipeline(
    source: str,
    out_path: Path,
    store: MediaStore,
    cfg: RunConfig,
    *,
    stt_engine: str,
    rights_attested: bool,
    project_id: str | None = None,
    use_comments: bool = True,
    on_progress: Progress | None = None,
) -> RunResult:
    say = on_progress or (lambda _: None)
    stages: list[Stage] = []

    def timed(name: str, fn: Callable[[], Any]) -> Any:
        started = time.monotonic()
        value = fn()
        stages.append(Stage(name, time.monotonic() - started))
        return value

    # 1. 에셋
    media = timed("영상 준비", lambda: ingest(source, store, on_progress=say))
    say(f"  {media.summary()}")

    is_youtube = media.source_kind == "youtube"
    meta = store.read_meta(media.asset_id) or {}
    url = meta.get("url") if is_youtube else None

    project = project_io.new_project(
        project_id or media.asset_id,
        "youtube" if is_youtube else "upload",
        url,
        rights_attested,
    )
    project["sourceAssetId"] = media.asset_id
    project["assets"] = {media.asset_id: media.asset}

    # 2. 대본 — 분석은 프록시가 아니라 추출한 wav로 한다
    wav = store.paths(media.asset_id).path("audio16k.wav")
    transcriber = get_transcriber(stt_engine)
    say(f"받아쓰는 중 ({transcriber.name})")
    stt = timed("받아쓰기", lambda: transcriber.transcribe(wav))
    if not stt.words:
        raise RuntimeError("대본을 한 줄도 받지 못했습니다. 음성이 없는 영상일 수 있어요.")
    say(f"  어절 {len(stt.words)}개")

    project["transcript"] = {
        "words": [
            {
                "id": w.id,
                "text": w.text,
                "startMs": w.start_ms,
                "endMs": w.end_ms,
                **({"speakerId": w.speaker_id} if w.speaker_id else {}),
                **({"confidence": w.confidence} if w.confidence is not None else {}),
            }
            for w in stt.words
        ],
        "sentences": project_io.sentences_from_words(stt.words),
    }

    view = project_io.view_from_project(project)
    report = CostReport(project_id=project["id"])
    report.stt = SttUsage(engine=stt.engine, audio_seconds=stt.audio_seconds, usd=stt.usd)

    # 3. 하이라이트
    say(f"하이라이트 찾는 중 · {cfg.request.describe()}")
    outcome = timed("하이라이트", lambda: extract_highlights(view, _llm(view, cfg, report), cfg))
    say(outcome.report())

    # 4. 실제 인기 댓글 (실패해도 진행한다)
    comments: list[Comment] = []
    if use_comments and is_youtube and url:
        video_id = video_id_from_url(url)
        if video_id:
            try:
                comments = timed("댓글", lambda: fetch_top_comments(video_id, limit=len(outcome.clips)))
                say(f"  인기 댓글 {len(comments)}개 (작성자 이름은 가림)")
            except CommentsUnavailable as exc:
                say(f"  댓글 건너뜀 — {exc}")

    updated = project_io.attach_clips(
        project, view, outcome.clips, cfg, stt.engine,
        credit=media.credit, comments=comments,
    )
    project_io.write_project(updated, out_path)

    return RunResult(
        project=updated,
        project_path=out_path,
        stages=stages,
        cost=report,
        media_seconds=media.info.duration_sec,
        clips=len(outcome.clips),
    )


def meta_path_note(store: MediaStore, asset_id: str) -> Path:
    return store.paths(asset_id).path(META)
