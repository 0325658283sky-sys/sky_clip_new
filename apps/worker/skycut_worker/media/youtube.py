"""유튜브 영상 받기 (yt-dlp CLI).

파이썬 모듈 대신 CLI를 쓴다. yt-dlp는 자주 바뀌지만 CLI 인자는 안정적이고,
설치도 따로 돌릴 수 있어 워커 배포와 분리된다.

**법적 주의**: 유튜브 약관은 영상 다운로드를 금지하고, 원저작물 저작권
문제도 남는다. 서비스는 사용자에게 권리 보유를 확인받고 기록하지만,
그것이 면책이 되지는 않는다. 작업지시서 v3 §9 참고.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

#: 이보다 긴 영상은 받지 않는다. 비용과 처리 시간이 급격히 늘어난다.
MAX_DURATION_SEC = 2 * 60 * 60

_ID_PATTERNS = (
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
)


class YoutubeError(RuntimeError):
    """사용자에게 그대로 보여 줄 수 있는 실패."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


#: stderr에서 찾을 문구 → (사유 코드, 사용자에게 보여 줄 말)
_FAILURES: tuple[tuple[str, str, str], ...] = (
    ("private video", "private", "비공개 영상이라 가져올 수 없어요."),
    ("members-only", "members_only", "멤버십 전용 영상이라 가져올 수 없어요."),
    ("join this channel", "members_only", "멤버십 전용 영상이라 가져올 수 없어요."),
    ("confirm your age", "age_restricted", "연령 제한 영상이라 가져올 수 없어요."),
    ("age-restricted", "age_restricted", "연령 제한 영상이라 가져올 수 없어요."),
    # 지역 차단은 문구가 여러 가지라 모두 적어 둔다. "video unavailable"보다 먼저 봐야 한다.
    ("not available in your country", "geo_blocked", "이 지역에서는 볼 수 없는 영상이에요."),
    ("not made this video available in your country", "geo_blocked", "이 지역에서는 볼 수 없는 영상이에요."),
    ("blocked it in your country", "geo_blocked", "이 지역에서는 볼 수 없는 영상이에요."),
    ("who has blocked it on copyright grounds", "geo_blocked", "저작권 문제로 막힌 영상이에요."),
    ("live event will begin", "live", "아직 시작하지 않은 라이브예요. 방송이 끝난 뒤 다시 시도하세요."),
    ("is live", "live", "진행 중인 라이브는 가져올 수 없어요. 방송이 끝난 뒤 다시 시도하세요."),
    ("confirm you're not a bot", "bot_check", "유튜브가 자동 접근을 막았어요. 잠시 뒤 다시 시도하세요."),
    ("sign in to confirm", "bot_check", "유튜브가 자동 접근을 막았어요. 잠시 뒤 다시 시도하세요."),
    ("video unavailable", "unavailable", "영상을 찾을 수 없어요. 주소를 확인해 주세요."),
    ("removed by the uploader", "unavailable", "올린 사람이 삭제한 영상이에요."),
)


def video_id_from_url(url: str) -> str | None:
    for pattern in _ID_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1)
    return None


def require_yt_dlp() -> None:
    if shutil.which("yt-dlp") is None:
        raise YoutubeError(
            "tool_missing",
            "yt-dlp를 찾을 수 없습니다.  pip install yt-dlp  또는 https://github.com/yt-dlp/yt-dlp 참고",
        )


def _classify(stderr: str) -> YoutubeError:
    low = stderr.lower()
    for needle, reason, message in _FAILURES:
        if needle in low:
            return YoutubeError(reason, message)
    tail = stderr.strip().splitlines()[-1:] or ["알 수 없는 오류"]
    return YoutubeError("unknown", f"영상을 가져오지 못했어요: {tail[0]}")


@dataclass(frozen=True)
class YoutubeMeta:
    video_id: str
    title: str
    channel: str
    duration_sec: float
    is_live: bool


def fetch_meta(url: str) -> YoutubeMeta:
    """받기 전에 정보만 본다. 너무 긴 영상을 내려받지 않기 위해서다."""
    require_yt_dlp()
    proc = subprocess.run(
        ["yt-dlp", "--no-warnings", "--skip-download", "--dump-single-json", url],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise _classify(proc.stderr.decode("utf-8", "replace"))

    data = json.loads(proc.stdout.decode("utf-8", "replace"))
    if data.get("is_live"):
        raise YoutubeError("live", "진행 중인 라이브는 가져올 수 없어요. 방송이 끝난 뒤 다시 시도하세요.")

    duration = float(data.get("duration") or 0)
    if duration > MAX_DURATION_SEC:
        raise YoutubeError(
            "too_long",
            f"{MAX_DURATION_SEC // 3600}시간을 넘는 영상은 처리할 수 없어요 "
            f"(이 영상 {duration / 3600:.1f}시간). 구간을 나눠서 올려 주세요.",
        )

    return YoutubeMeta(
        video_id=str(data.get("id") or ""),
        title=str(data.get("title") or ""),
        channel=str(data.get("uploader") or data.get("channel") or ""),
        duration_sec=duration,
        is_live=bool(data.get("is_live")),
    )


def download(url: str, dst: Path, max_height: int = 1080) -> Path:
    """영상을 내려받는다. 1080p를 넘지 않는 선에서 가장 좋은 화질."""
    require_yt_dlp()
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "yt-dlp", "--no-warnings", "--no-playlist",
            "-f", f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best",
            "--merge-output-format", "mp4",
            "-o", str(dst),
            url,
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise _classify(proc.stderr.decode("utf-8", "replace"))
    if not dst.exists():
        # 확장자가 바뀌어 저장되는 경우가 있다
        found = next(iter(sorted(dst.parent.glob(f"{dst.stem}.*"))), None)
        if found is None:
            raise YoutubeError("unknown", "영상을 받았지만 파일을 찾을 수 없어요.")
        return found
    return dst
