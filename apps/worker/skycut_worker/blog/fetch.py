"""블로그 글 가져오기.

네이버 블로그는 본문이 iframe 안에 있어서 **모바일 주소로 바꿔** 받는다.
그래야 본문이 한 페이지에 들어 있다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse, urlunparse

#: 일반적인 브라우저로 보이게 한다. 사용자 정보는 넣지 않는다.
USER_AGENT = "Mozilla/5.0 (compatible; SkyCut/0.1; +https://example.invalid/bot)"

#: 이보다 큰 문서는 블로그 글이 아니다
MAX_BYTES = 8 * 1024 * 1024

_NAVER_HOSTS = {"blog.naver.com", "m.blog.naver.com"}
_NAVER_PATH = re.compile(r"^/([^/]+)/(\d+)")


class BlogFetchError(RuntimeError):
    """사용자에게 그대로 보여 줄 수 있는 실패."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class FetchedPage:
    url: str
    html: str
    final_url: str


def is_probably_blog(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def normalize(url: str) -> str:
    """네이버 블로그는 모바일 주소로 바꾼다. 나머지는 그대로."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host in _NAVER_HOSTS:
        match = _NAVER_PATH.match(parsed.path)
        if match:
            blog_id, log_no = match.groups()
            return f"https://m.blog.naver.com/{blog_id}/{log_no}"
        # ?blogId=...&logNo=... 형태
        query = dict(
            part.split("=", 1) for part in parsed.query.split("&") if "=" in part
        )
        if query.get("blogId") and query.get("logNo"):
            return f"https://m.blog.naver.com/{query['blogId']}/{query['logNo']}"
        return urlunparse(parsed._replace(netloc="m.blog.naver.com"))
    return url


def fetch(url: str, timeout: float = 30.0) -> FetchedPage:
    import httpx

    target = normalize(url)
    try:
        response = httpx.get(
            target,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ko,en;q=0.8",
            },
            follow_redirects=True,
            timeout=httpx.Timeout(timeout, connect=15.0),
        )
    except httpx.HTTPError as exc:
        raise BlogFetchError("network", f"글을 가져오지 못했어요: {exc}") from exc

    if response.status_code == 404:
        raise BlogFetchError("not_found", "글을 찾을 수 없어요. 주소를 확인해 주세요.")
    if response.status_code in (401, 403):
        raise BlogFetchError("forbidden", "비공개 글이거나 접근이 막혀 있어요.")
    if response.status_code >= 400:
        raise BlogFetchError("http_error", f"글을 가져오지 못했어요 (HTTP {response.status_code}).")

    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        raise BlogFetchError("not_html", f"웹 글이 아니에요 ({content_type or '형식 불명'}).")
    if len(response.content) > MAX_BYTES:
        raise BlogFetchError("too_large", "문서가 너무 커요.")

    return FetchedPage(url=url, html=response.text, final_url=str(response.url))
