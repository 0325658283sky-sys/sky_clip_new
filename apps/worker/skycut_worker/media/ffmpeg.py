"""ffmpeg / ffprobe 래퍼.

브라우저에서 인코딩하지 않는다(ARCHITECTURE.md 규칙 7). 파형과 썸네일
스트립처럼 편집 화면이 쓸 보조 데이터도 여기서 만든다.
"""
from __future__ import annotations

import json
import shutil
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

#: 미리보기용 프록시 높이. 분석과 웹 미리보기는 이걸 쓴다.
PROXY_HEIGHT = 480
#: 최종 내보내기 높이 상한
SOURCE_MAX_HEIGHT = 1080
#: STT에 넣을 오디오
WAV_RATE = 16_000


class MediaToolMissing(RuntimeError):
    pass


def require_tools() -> None:
    missing = [name for name in ("ffmpeg", "ffprobe") if shutil.which(name) is None]
    if missing:
        raise MediaToolMissing(
            f"{', '.join(missing)} 을(를) 찾을 수 없습니다.\n"
            "https://ffmpeg.org 에서 설치하고 PATH에 넣으세요."
        )


def _run(args: list[str], what: str) -> subprocess.CompletedProcess[bytes]:
    proc = subprocess.run(args, capture_output=True)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-5:]
        raise RuntimeError(f"{what} 실패:\n  " + "\n  ".join(tail))
    return proc


@dataclass(frozen=True)
class MediaInfo:
    width: int
    height: int
    duration_ms: int
    fps: float
    has_audio: bool

    @property
    def duration_sec(self) -> float:
        return self.duration_ms / 1000

    @property
    def has_video(self) -> bool:
        return self.width > 0 and self.height > 0


def probe(path: Path) -> MediaInfo:
    """영상이든 오디오든 길이와 크기를 본다. 오디오 전용이면 width/height가 0이다."""
    proc = _run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=width,height,avg_frame_rate,codec_type:format=duration",
            "-of", "json", str(path),
        ],
        f"ffprobe({path.name})",
    )
    data = json.loads(proc.stdout.decode("utf-8", "replace"))
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)

    fps = 0.0
    if video is not None:
        num, _, den = (video.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den) if den and float(den) else 0.0
    duration = float(data.get("format", {}).get("duration") or 0.0)

    return MediaInfo(
        width=int((video or {}).get("width") or 0),
        height=int((video or {}).get("height") or 0),
        duration_ms=int(round(duration * 1000)),
        fps=round(fps, 3),
        has_audio=has_audio,
    )


def require_video(path: Path) -> MediaInfo:
    info = probe(path)
    if not info.has_video:
        raise RuntimeError(f"{path.name}: 영상 트랙이 없습니다.")
    return info


def make_source(src: Path, dst: Path, max_height: int = SOURCE_MAX_HEIGHT) -> None:
    """최종 렌더용. 1080p를 넘으면 줄이고, 그 이하는 다시 인코딩하지 않는다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    info = require_video(src)
    if info.height <= max_height and src.suffix.lower() == ".mp4":
        shutil.copyfile(src, dst)
        return
    _run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(src),
            "-vf", f"scale=-2:'min({max_height},ih)'",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            str(dst),
        ],
        "원본 변환",
    )


def make_proxy(src: Path, dst: Path, height: int = PROXY_HEIGHT) -> None:
    """미리보기용 480p. 빠르게 만들고 용량을 줄인다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    _run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(src),
            "-vf", f"scale=-2:'min({height},ih)'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            str(dst),
        ],
        "프록시 생성",
    )


def extract_wav(src: Path, dst: Path, rate: int = WAV_RATE) -> None:
    """STT에 넣을 16kHz 모노 wav."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    _run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", str(rate), str(dst)],
        "오디오 추출",
    )


def waveform_peaks(src: Path, buckets: int = 2000) -> list[float]:
    """타임라인에 그릴 파형. 구간별 최대 진폭을 0~1로 돌려준다."""
    proc = _run(
        [
            "ffmpeg", "-v", "error", "-i", str(src),
            "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
        ],
        "파형 추출",
    )
    raw = proc.stdout
    count = len(raw) // 2
    if count == 0:
        return []
    samples = struct.unpack(f"<{count}h", raw[: count * 2])

    # 구간 수를 정확히 buckets로 맞춘다 (나눠떨어지지 않아 하나 더 생기지 않도록)
    want = min(buckets, count)
    peaks: list[float] = []
    for i in range(want):
        start = count * i // want
        end = max(start + 1, count * (i + 1) // want)
        chunk = samples[start:end]
        peaks.append(round(max(abs(min(chunk)), abs(max(chunk))) / 32768, 4))
    return peaks


def thumbnail_strip(src: Path, dst: Path, count: int = 40, tile_height: int = 90) -> None:
    """타임라인에 깔 썸네일 스트립 한 장 (가로로 이어 붙인다)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    info = require_video(src)
    seconds = max(1.0, info.duration_sec)
    fps = count / seconds
    _run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", str(src),
            "-vf", f"fps={fps:.6f},scale=-2:{tile_height},tile={count}x1",
            "-frames:v", "1", "-q:v", "4",
            str(dst),
        ],
        "썸네일 스트립 생성",
    )
