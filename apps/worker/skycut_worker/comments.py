"""유튜브 인기 댓글 가져오기 (YouTube Data API v3).

하단 카드에 쓴다. **AI가 지어낸 문장을 댓글처럼 보여 주지 않는다.**
실제 댓글만 쓰고, 작성자 이름은 가린다.

읽기 전용 API 키만 쓴다. 업로드 권한(OAuth)과는 다르다.
"""
from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass

ENDPOINT = "https://www.googleapis.com/youtube/v3/commentThreads"

#: 하단 카드에 들어갈 수 있는 길이
MAX_LENGTH = 60
MIN_LENGTH = 4

_URL_RE = re.compile(r"https?://\S+")
_WHITESPACE_RE = re.compile(r"\s+")
_HANGUL_RE = re.compile(r"[가-힣]")


class CommentsUnavailable(RuntimeError):
    """댓글을 못 가져와도 쇼츠는 만들 수 있다. 치명적 오류가 아니다."""


@dataclass(frozen=True)
class Comment:
    text: str
    author_masked: str
    likes: int


def mask_author(name: str) -> str:
    """작성자 이름을 가린다. 첫 글자만 남기고 나머지는 ○."""
    cleaned = name.lstrip("@").strip()
    if not cleaned:
        return "시청자"
    head = cleaned[0]
    return f"{head}{'○' * min(3, max(1, len(cleaned) - 1))}"


def clean_text(raw: str) -> str:
    text = html.unescape(raw)
    text = text.replace("<br>", " ").replace("<br/>", " ")
    text = re.sub(r"<[^>]+>", "", text)
    text = _URL_RE.sub("", text)
    return _WHITESPACE_RE.sub(" ", text).strip()


def is_usable(text: str) -> bool:
    """하단 카드에 쓸 만한가. 한 줄로 읽히고, 한국어가 들어 있어야 한다."""
    if not (MIN_LENGTH <= len(text) <= MAX_LENGTH):
        return False
    if not _HANGUL_RE.search(text):
        return False
    # 타임스탬프만 적은 댓글, 구독 요청 같은 것은 뺀다
    if re.fullmatch(r"[\d:\s]+", text):
        return False
    return "구독" not in text and "좋아요" not in text


def fetch_top_comments(video_id: str, limit: int = 5, api_key: str | None = None) -> list[Comment]:
    key = api_key or os.getenv("YOUTUBE_API_KEY")
    if not key:
        raise CommentsUnavailable(
            "YOUTUBE_API_KEY가 없습니다. 저장소 루트 .env에 넣으면 실제 인기 댓글을 하단 카드에 쓸 수 있어요."
        )

    import httpx

    try:
        response = httpx.get(
            ENDPOINT,
            params={
                "part": "snippet",
                "videoId": video_id,
                "order": "relevance",  # 인기순
                "maxResults": 50,
                "textFormat": "plainText",
                "key": key,
            },
            timeout=httpx.Timeout(30.0),
        )
    except httpx.HTTPError as exc:
        raise CommentsUnavailable(f"댓글을 불러오지 못했어요: {exc}") from exc

    if response.status_code == 403:
        raise CommentsUnavailable(
            "댓글 접근이 거부됐어요. 영상의 댓글이 꺼져 있거나 API 할당량을 넘었을 수 있어요."
        )
    if response.status_code == 404:
        raise CommentsUnavailable("영상을 찾을 수 없어요.")
    if response.status_code >= 400:
        raise CommentsUnavailable(f"댓글을 불러오지 못했어요 (HTTP {response.status_code}).")

    out: list[Comment] = []
    for item in response.json().get("items", []):
        snippet = (item.get("snippet") or {}).get("topLevelComment", {}).get("snippet") or {}
        text = clean_text(str(snippet.get("textDisplay") or snippet.get("textOriginal") or ""))
        if not is_usable(text):
            continue
        out.append(
            Comment(
                text=text,
                author_masked=mask_author(str(snippet.get("authorDisplayName") or "")),
                likes=int(snippet.get("likeCount") or 0),
            )
        )
        if len(out) >= limit:
            break

    if not out:
        raise CommentsUnavailable("하단 카드에 쓸 만한 댓글이 없어요.")
    return out
