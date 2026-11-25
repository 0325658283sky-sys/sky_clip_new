"""미디어 처리와 유튜브 실패 사유 구분.

ffmpeg가 있어야 하는 테스트는 아주 짧은 영상을 그 자리에서 만들어 쓴다.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from skycut_worker.media import MediaStore, ingest
from skycut_worker.media.ffmpeg import probe, require_video, waveform_peaks
from skycut_worker.media.store import PROXY, SOURCE, WAV, asset_id_for_file, asset_id_for_youtube
from skycut_worker.media.youtube import (
    _classify,
    _clear_leftovers,
    _finished_file,
    video_id_from_url,
)

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg가 없습니다")


@pytest.fixture(scope="module")
def tiny_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("media") / "tiny.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


# ── 유튜브 URL 파싱 ───────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ",
    ],
)
def test_유튜브_주소에서_아이디를_뽑는다(url: str) -> None:
    assert video_id_from_url(url) == "dQw4w9WgXcQ"


def test_유튜브가_아니면_None() -> None:
    assert video_id_from_url("https://blog.naver.com/x/1") is None
    assert video_id_from_url("C:/videos/my.mp4") is None


# ── 실패 사유 구분 ────────────────────────────────────────


@pytest.mark.parametrize(
    ("stderr", "reason"),
    [
        ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"),
        ("ERROR: Sign in to confirm your age. This video may be inappropriate", "age_restricted"),
        ("ERROR: The uploader has not made this video available in your country", "geo_blocked"),
        ("ERROR: This live event will begin in 2 hours", "live"),
        ("ERROR: Sign in to confirm you're not a bot", "bot_check"),
        ("ERROR: Video unavailable", "unavailable"),
        ("ERROR: Join this channel to get access to members-only content", "members_only"),
        ("ERROR: 알 수 없는 무언가", "unknown"),
    ],
)
def test_실패_사유를_구분한다(stderr: str, reason: str) -> None:
    err = _classify(stderr)
    assert err.reason == reason
    assert str(err)  # 사용자에게 보여 줄 말이 있어야 한다


# ── 받다 만 흔적 ───────────────────────────────────────────
#
# 같은 영상을 두 작업이 동시에 받다가 서로의 조각 파일을 지워 둘 다 죽은 적이
# 있다. 이제 받기는 작업 폴더에서 하므로 조각이 에셋 폴더에 남지 않고,
# 예전에 끊겨 남은 것은 지운다.


def test_받다_만_조각을_지운다(tmp_path: Path) -> None:
    for name in ("download.mp4.part", "download.f616.mp4.part-Frag588", "download.f616.mp4.ytdl"):
        (tmp_path / name).write_bytes(b"x")
    done = tmp_path / "download.mp4"
    done.write_bytes(b"keep")

    _clear_leftovers(tmp_path, "download")

    assert done.exists(), "다 받은 파일은 남겨야 한다"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["download.mp4"]


def test_받다_만_것을_완성본으로_고르지_않는다(tmp_path: Path) -> None:
    (tmp_path / "download.mp4.part").write_bytes(b"x")
    (tmp_path / "download.f616.mp4.ytdl").write_bytes(b"x")
    assert _finished_file(tmp_path, "download") is None

    (tmp_path / "download.mkv").write_bytes(b"ok")
    assert _finished_file(tmp_path, "download").name == "download.mkv"


def test_다른_에셋의_파일은_건드리지_않는다(tmp_path: Path) -> None:
    keep = tmp_path / "source.mp4.part"
    keep.write_bytes(b"x")
    _clear_leftovers(tmp_path, "download")
    assert keep.exists()


# ── 에셋 ID ───────────────────────────────────────────────


def test_유튜브_에셋_아이디는_영상_아이디에서_나온다() -> None:
    assert asset_id_for_youtube("dQw4w9WgXcQ") == "yt-dQw4w9WgXcQ"


def test_에셋_아이디에_위험한_문자가_들어가지_않는다() -> None:
    assert asset_id_for_youtube("../../etc/passwd") == "yt-etcpasswd"


@needs_ffmpeg
def test_같은_파일은_같은_아이디(tiny_video: Path, tmp_path: Path) -> None:
    copy = tmp_path / "copy.mp4"
    shutil.copyfile(tiny_video, copy)
    assert asset_id_for_file(tiny_video) == asset_id_for_file(copy)


# ── ffmpeg ────────────────────────────────────────────────


@needs_ffmpeg
def test_영상_정보를_읽는다(tiny_video: Path) -> None:
    info = probe(tiny_video)
    assert (info.width, info.height) == (320, 180)
    assert 2500 <= info.duration_ms <= 3500
    assert info.has_audio
    assert info.has_video


@needs_ffmpeg
def test_오디오만_있어도_읽는다(tiny_video: Path, tmp_path: Path) -> None:
    """STT에 넣을 wav는 영상 트랙이 없다. 그래도 길이를 알 수 있어야 한다."""
    wav = tmp_path / "a.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(tiny_video), "-vn", "-ac", "1", "-ar", "16000", str(wav)],
        check=True, capture_output=True,
    )
    info = probe(wav)
    assert info.duration_ms > 0
    assert not info.has_video
    with pytest.raises(RuntimeError, match="영상 트랙이 없습니다"):
        require_video(wav)


@needs_ffmpeg
def test_파형_구간_수가_정확하다(tiny_video: Path) -> None:
    peaks = waveform_peaks(tiny_video, buckets=100)
    assert len(peaks) == 100
    assert all(0.0 <= p <= 1.0 for p in peaks)


# ── ingest ────────────────────────────────────────────────


@needs_ffmpeg
def test_에셋을_모두_만든다(tiny_video: Path, tmp_path: Path) -> None:
    store = MediaStore(tmp_path / "store")
    result = ingest(str(tiny_video), store)

    paths = store.paths(result.asset_id)
    for name in (SOURCE, PROXY, WAV):
        assert paths.exists(name), f"{name} 이(가) 없습니다"

    assert result.asset["variants"] == {
        "source": f"{result.asset_id}/{SOURCE}",
        "proxy": f"{result.asset_id}/{PROXY}",
        "wav16k": f"{result.asset_id}/{WAV}",
    }
    assert not result.reused


@needs_ffmpeg
def test_프록시는_원본보다_작다(tiny_video: Path, tmp_path: Path) -> None:
    store = MediaStore(tmp_path / "store")
    result = ingest(str(tiny_video), store)
    paths = store.paths(result.asset_id)
    assert probe(paths.path(PROXY)).height <= probe(paths.path(SOURCE)).height


@needs_ffmpeg
def test_두_번째_실행은_다시_만들지_않는다(tiny_video: Path, tmp_path: Path) -> None:
    store = MediaStore(tmp_path / "store")
    ingest(str(tiny_video), store)
    again = ingest(str(tiny_video), store)
    assert again.reused


@needs_ffmpeg
def test_파형_파일을_남긴다(tiny_video: Path, tmp_path: Path) -> None:
    """편집 화면이 쓸 보조 데이터도 워커가 만든다 (브라우저 인코딩 금지)."""
    store = MediaStore(tmp_path / "store")
    result = ingest(str(tiny_video), store)
    data = json.loads((store.paths(result.asset_id).dir / "waveform.json").read_text(encoding="utf-8"))
    assert data["peaks"]


def test_없는_파일은_바로_알려준다(tmp_path: Path) -> None:
    store = MediaStore(tmp_path / "store")
    with pytest.raises(FileNotFoundError):
        ingest(str(tmp_path / "없음.mp4"), store)
