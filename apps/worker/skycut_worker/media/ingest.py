"""입력 → 에셋.

    유튜브 URL 또는 로컬 MP4
      → source.mp4 (최대 1080p)
      → proxy.mp4 (480p, 미리보기·분석용)
      → audio16k.wav (STT 입력)
      → waveform.json, thumbs.jpg (편집 화면용 보조 데이터)

이미 만들어 둔 파일은 다시 만들지 않는다. 같은 영상을 두 번 넣어도 빠르다.
"""
from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import ffmpeg, youtube
from .store import (
    META,
    PROXY,
    SOURCE,
    THUMBS,
    WAV,
    WAVEFORM,
    AssetPaths,
    MediaStore,
    asset_id_for_file,
    asset_id_for_youtube,
)

Progress = Callable[[str], None]


@dataclass
class IngestResult:
    asset_id: str
    asset: dict[str, Any]
    info: ffmpeg.MediaInfo
    source_kind: str
    """youtube | upload"""
    credit: dict[str, str] | None = None
    download_seconds: float = 0.0
    process_seconds: float = 0.0
    reused: bool = False

    def summary(self) -> str:
        mins, secs = divmod(int(self.info.duration_sec), 60)
        head = f"{self.asset_id} · {self.info.width}×{self.info.height} · {mins}분 {secs}초"
        if self.reused:
            return head + " (이미 받아 둔 것을 다시 씀)"
        return head + f" · 다운로드 {self.download_seconds:.0f}초 · 변환 {self.process_seconds:.0f}초"


def ingest(
    source: str,
    store: MediaStore,
    *,
    force: bool = False,
    on_progress: Progress | None = None,
) -> IngestResult:
    """유튜브 URL이거나 로컬 파일 경로."""
    ffmpeg.require_tools()
    say = on_progress or (lambda _: None)

    if youtube.video_id_from_url(source):
        return _ingest_youtube(source, store, force=force, say=say)
    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {path}")
    return _ingest_file(path, store, force=force, say=say)


def _ingest_youtube(url: str, store: MediaStore, *, force: bool, say: Progress) -> IngestResult:
    say("영상 정보 확인 중")
    meta = youtube.fetch_meta(url)
    asset_id = asset_id_for_youtube(meta.video_id)
    paths = store.reserve(asset_id)

    had_everything = not force and _is_complete(paths)
    download_seconds = 0.0
    source_for_derive = paths.path(SOURCE)

    if force or not paths.exists(SOURCE):
        say(f"영상 받는 중 — {meta.title[:40]}")
        started = time.monotonic()
        source_for_derive = youtube.download(url, paths.path("download.mp4"))
        download_seconds = time.monotonic() - started

    process_started = time.monotonic()
    _derive(source_for_derive, paths, force=force, say=say)
    process_seconds = time.monotonic() - process_started

    if source_for_derive != paths.path(SOURCE):
        source_for_derive.unlink(missing_ok=True)

    info = ffmpeg.probe(paths.path(SOURCE))
    credit = {"channelName": meta.channel, "videoTitle": meta.title} if meta.channel else None
    store.write_json(
        asset_id,
        META,
        {"sourceKind": "youtube", "url": url, "videoId": meta.video_id,
         "title": meta.title, "channel": meta.channel},
    )
    return IngestResult(
        asset_id=asset_id,
        asset=store.asset_entry(asset_id, kind="video", width=info.width, height=info.height,
                                duration_ms=info.duration_ms),
        info=info,
        source_kind="youtube",
        credit=credit,
        download_seconds=download_seconds,
        process_seconds=process_seconds,
        reused=had_everything,
    )


def _ingest_file(path: Path, store: MediaStore, *, force: bool, say: Progress) -> IngestResult:
    asset_id = asset_id_for_file(path)
    paths = store.reserve(asset_id)
    had_everything = not force and _is_complete(paths)

    started = time.monotonic()
    _derive(path, paths, force=force, say=say)
    process_seconds = time.monotonic() - started

    info = ffmpeg.probe(paths.path(SOURCE))
    store.write_json(asset_id, META, {"sourceKind": "upload", "originalName": path.name})
    return IngestResult(
        asset_id=asset_id,
        asset=store.asset_entry(asset_id, kind="video", width=info.width, height=info.height,
                                duration_ms=info.duration_ms),
        info=info,
        source_kind="upload",
        process_seconds=process_seconds,
        reused=had_everything,
    )


def _is_complete(paths: AssetPaths) -> bool:
    """다시 만들 것이 없는 상태인가."""
    return all(paths.exists(name) for name in (SOURCE, PROXY, WAV, WAVEFORM))


def _derive(src: Path, paths: AssetPaths, *, force: bool, say: Progress) -> None:
    """원본에서 나머지를 만든다. 이미 있는 것은 건너뛴다."""
    if src != paths.path(SOURCE) and (force or not paths.exists(SOURCE)):
        say("원본 정리 중")
        ffmpeg.make_source(src, paths.path(SOURCE))
    source = paths.path(SOURCE)

    if force or not paths.exists(PROXY):
        say("미리보기용 480p 만드는 중")
        ffmpeg.make_proxy(source, paths.path(PROXY))

    if force or not paths.exists(WAV):
        say("음성 추출 중")
        ffmpeg.extract_wav(source, paths.path(WAV))

    if force or not paths.exists(WAVEFORM):
        say("파형 계산 중")
        peaks = ffmpeg.waveform_peaks(paths.path(WAV))
        paths.path(WAVEFORM).write_text(json.dumps({"peaks": peaks}), encoding="utf-8")

    if force or not paths.exists(THUMBS):
        say("썸네일 스트립 만드는 중")
        try:
            ffmpeg.thumbnail_strip(paths.path(PROXY), paths.path(THUMBS))
        except RuntimeError:
            # 편집 화면 보조 데이터일 뿐이라 실패해도 진행한다
            say("  썸네일 스트립은 건너뜁니다")


def copy_into_renderer_public(store: MediaStore, public_dir: Path) -> None:
    """렌더러가 staticFile로 찾을 수 있게 에셋을 공개 폴더로 옮긴다.

    같은 폴더를 쓰면 복사하지 않는다.
    """
    public_dir = public_dir.resolve()
    if store.root.resolve() == public_dir:
        return
    public_dir.mkdir(parents=True, exist_ok=True)
    for child in store.root.iterdir():
        if child.is_dir():
            shutil.copytree(child, public_dir / child.name, dirs_exist_ok=True)
