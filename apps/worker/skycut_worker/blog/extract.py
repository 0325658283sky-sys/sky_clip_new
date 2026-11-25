"""블로그 본문과 이미지 뽑아내기.

네이버 블로그와 티스토리는 본문 컨테이너가 정해져 있어 그걸 먼저 찾고,
나머지 웹 글은 글자 밀도로 본문 영역을 고른다.

광고·관련 글·댓글·공유 버튼 영역은 걷어낸다. 새 의존성 없이
표준 라이브러리 HTMLParser만 쓴다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin

#: 본문이 아닌 영역. class/id에 이 말이 들어가면 통째로 버린다.
NOISE_TOKENS = (
    "comment", "reply", "advertise", "advertisement", "adsense", "ad_", "_ad", "banner",
    "related", "recommend", "popular", "sidebar", "footer", "header", "nav", "gnb", "lnb",
    "share", "sns", "social", "tag", "category", "pagination", "paging", "breadcrumb",
    "profile", "author-info", "subscribe", "newsletter", "popup", "modal", "cookie",
    "sponsor", "promotion",
    # 네이버·티스토리·구글의 실제 광고 컨테이너 이름
    "revenue_unit", "ssp_", "da_wrap", "google_ads", "adsbygoogle", "adfit",
    "댓글", "광고", "관련글", "공유", "구독",
)

#: 통째로 버릴 태그
DROP_TAGS = frozenset({"script", "style", "noscript", "iframe", "svg", "form", "button", "nav", "footer", "aside"})

#: 문단을 끊는 태그
BLOCK_TAGS = frozenset({"p", "div", "br", "li", "section", "article", "blockquote", "figure", "figcaption",
                        "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr", "table", "pre"})

HEADING_TAGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})

#: 플랫폼별 본문 컨테이너. 위에서부터 찾는다.
CONTENT_SELECTORS: tuple[tuple[str, str], ...] = (
    # 네이버 블로그 (SmartEditor ONE / 구버전)
    ("class", "se-main-container"),
    ("id", "postViewArea"),
    ("class", "post-view"),
    # 티스토리
    ("class", "entry-content"),
    ("class", "article_view"),
    ("class", "contents_style"),
    ("class", "tt_article_useless_p_margin"),
    # 브런치 / 벨로그 / 일반
    ("class", "wrap_body"),
    ("class", "atom-one"),
    ("class", "article-body"),
    ("class", "post-content"),
    ("class", "entry-body"),
)

_WS = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")
#: 본문에 섞여 들어오는 흔한 잡음 줄
_JUNK_LINE = re.compile(
    r"^(공유하기|게시글 관리|저작자 표시|구독하기|이웃추가|태그|관련글|댓글\s*\d*|더보기|목록|이전|다음)\s*$"
)


@dataclass
class ExtractedImage:
    url: str
    alt: str = ""
    #: 본문에서 몇 번째 문단 뒤에 있었는지
    after_paragraph: int = 0


@dataclass
class ExtractedArticle:
    title: str
    paragraphs: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    images: list[ExtractedImage] = field(default_factory=list)
    blog_name: str = ""
    author: str = ""

    @property
    def text(self) -> str:
        return "\n\n".join(self.paragraphs)

    @property
    def char_count(self) -> int:
        return sum(len(p) for p in self.paragraphs)


def _is_noisy(attrs: dict[str, str]) -> bool:
    blob = f"{attrs.get('class', '')} {attrs.get('id', '')} {attrs.get('role', '')}".lower()
    return any(token in blob for token in NOISE_TOKENS)


class _Collector(HTMLParser):
    """한 컨테이너 안의 글자와 이미지를 모은다."""

    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self._base = base_url
        self._drop_depth = 0
        self._noise_depth = 0
        self._noise_tag: str | None = None
        self._buffer: list[str] = []
        self.paragraphs: list[str] = []
        self.headings: list[str] = []
        self.images: list[ExtractedImage] = []
        self._in_heading = False

    # ── 내부 ──

    def _flush(self) -> None:
        text = _WS.sub(" ", "".join(self._buffer)).strip()
        self._buffer = []
        if not text or _JUNK_LINE.match(text):
            return
        if self._in_heading:
            self.headings.append(text)
        self.paragraphs.append(text)

    # ── HTMLParser ──

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {k: (v or "") for k, v in attrs}

        if self._drop_depth or self._noise_depth:
            if tag in DROP_TAGS:
                self._drop_depth += 1
            elif self._noise_tag == tag:
                self._noise_depth += 1
            return

        if tag in DROP_TAGS:
            self._drop_depth = 1
            return
        if _is_noisy(values):
            self._noise_depth = 1
            self._noise_tag = tag
            return

        if tag == "img":
            src = values.get("data-lazy-src") or values.get("data-src") or values.get("src") or ""
            if src and not src.startswith("data:"):
                self.images.append(
                    ExtractedImage(
                        url=urljoin(self._base, src),
                        alt=values.get("alt", "").strip(),
                        after_paragraph=len(self.paragraphs),
                    )
                )
            return

        if tag in BLOCK_TAGS:
            self._flush()
            if tag in HEADING_TAGS:
                self._in_heading = True

    def handle_endtag(self, tag: str) -> None:
        if self._drop_depth:
            if tag in DROP_TAGS:
                self._drop_depth -= 1
            return
        if self._noise_depth:
            if tag == self._noise_tag:
                self._noise_depth -= 1
                if self._noise_depth == 0:
                    self._noise_tag = None
            return
        if tag in BLOCK_TAGS:
            self._flush()
            if tag in HEADING_TAGS:
                self._in_heading = False

    def handle_data(self, data: str) -> None:
        if self._drop_depth or self._noise_depth:
            return
        self._buffer.append(data)

    def close(self) -> None:  # type: ignore[override]
        super().close()
        self._flush()


def _inner_html(html: str, tag: str, open_end: int) -> str:
    """여는 태그 바로 뒤부터 짝이 맞는 닫는 태그 앞까지.

    끝을 제대로 찾지 않으면 뒤에 오는 댓글·사이드바까지 딸려 온다.
    """
    depth = 1
    cursor = open_end
    token = re.compile(rf"</?{tag}\b", re.IGNORECASE)
    while depth > 0:
        found = token.search(html, cursor)
        if not found:
            return html[open_end:]
        depth += -1 if found.group(0).startswith("</") else 1
        cursor = found.end()
        if depth == 0:
            return html[open_end : found.start()]
    return html[open_end:]


def _find_container(html: str, attr: str, value: str) -> str | None:
    """`class="... value ..."` 또는 `id="value"` 인 요소의 안쪽 HTML."""
    pattern = re.compile(
        rf'<(\w+)[^>]*\b{attr}\s*=\s*["\'][^"\']*\b{re.escape(value)}\b[^"\']*["\'][^>]*>',
        re.IGNORECASE,
    )
    match = pattern.search(html)
    if not match:
        return None
    return _inner_html(html, match.group(1).lower(), match.end())


def _title_of(html: str) -> str:
    for pattern in (
        r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
        r"<title[^>]*>(.*?)</title>",
        r"<h1[^>]*>(.*?)</h1>",
    ):
        match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
        if match:
            text = re.sub(r"<[^>]+>", "", unescape(match.group(1)))
            text = _WS.sub(" ", text).strip()
            if text:
                return text
    return ""


def _meta(html: str, prop: str) -> str:
    match = re.search(
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
        html,
        re.IGNORECASE,
    )
    return unescape(match.group(1)).strip() if match else ""


def extract(html: str, url: str) -> ExtractedArticle:
    """HTML → 본문. 플랫폼 컨테이너를 먼저 찾고, 없으면 글자 밀도로 고른다."""
    container: str | None = None
    for attr, value in CONTENT_SELECTORS:
        found = _find_container(html, attr, value)
        # 알려진 컨테이너를 찾았으면 짧아도 그걸 믿는다. 밀도 추정보다 정확하다.
        if found and len(_strip_tags(found)) > 30:
            container = found
            break

    if container is None:
        container = _densest_block(html)

    collector = _Collector(url)
    collector.feed(container)
    collector.close()

    paragraphs = [p for p in collector.paragraphs if len(p) >= 2]
    return ExtractedArticle(
        title=_title_of(html),
        paragraphs=paragraphs,
        headings=collector.headings,
        images=collector.images,
        blog_name=_meta(html, "og:site_name"),
        author=_meta(html, "author") or _meta(html, "article:author"),
    )


def _strip_tags(html: str) -> str:
    return _WS.sub(" ", re.sub(r"<[^>]+>", " ", html)).strip()


def _densest_block(html: str) -> str:
    """컨테이너를 못 찾았을 때. 글자가 가장 빽빽한 <article>/<main>/<div>를 고른다."""
    best: str | None = None
    best_score = 0.0
    attr_re = re.compile(r'(?:class|id|role)\s*=\s*["\']([^"\']*)["\']', re.IGNORECASE)

    for tag in ("article", "main", "div"):
        for match in re.finditer(rf"<{tag}\b([^>]*)>", html, re.IGNORECASE):
            blob = " ".join(attr_re.findall(match.group(1))).lower()
            if any(token in blob for token in NOISE_TOKENS):
                continue  # 댓글·사이드바 컨테이너는 아예 후보에서 뺀다

            chunk = _inner_html(html, tag, match.end())
            text_len = len(_strip_tags(chunk))
            if text_len < 40:
                continue
            # 링크가 빽빽하면 메뉴나 목록이다. 글자 수에 비례해 깎는다.
            links = len(re.findall(r"<a\b", chunk, re.IGNORECASE))
            score = text_len * (1.0 - min(0.9, links * 12 / max(text_len, 1)))
            if score > best_score:
                best_score = score
                best = chunk

    return best if best is not None else html
