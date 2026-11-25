"""블로그 본문 추출.

**M3 Gate: 광고·댓글·관련 글 영역이 본문에 섞이지 않을 것.**
"""
from __future__ import annotations

import pytest

from skycut_worker.blog.extract import extract
from skycut_worker.blog.fetch import normalize

NAVER_HTML = """
<html><head>
<meta property="og:title" content="주말 당일치기 근교 산책 코스 3곳">
<meta property="og:site_name" content="주말 산책 기록">
<title>주말 당일치기 근교 산책 코스 3곳 : 네이버 블로그</title>
</head><body>
<div id="header"><a href="/">홈</a><a href="/about">소개</a></div>
<div class="se-main-container">
  <h2>멀리 안 가도 되는 곳</h2>
  <p>주말에 멀리 가긴 부담될 때가 있죠. 그럴 때 가기 좋은 곳을 정리했어요.</p>
  <img src="/img/walk1.jpg" alt="강변 산책길">
  <p>첫 번째는 강변 산책길입니다. 지하철로 한 시간이면 갈 수 있어요.</p>
  <img src="https://cdn.example.com/walk2.jpg" alt="숲길">
  <p>두 번째는 숲길 코스예요. 나무 그늘이 많아서 여름에도 걷기 좋습니다.</p>
  <script>var tracking = 1;</script>
  <div class="revenue_unit_wrap"><span>광고입니다</span></div>
</div>
<div class="comment_area"><p>댓글: 저도 가봤어요!</p><p>댓글: 정보 감사합니다</p></div>
<div class="related_post"><a href="/2">관련글: 다른 산책 코스</a></div>
</body></html>
"""

TISTORY_HTML = """
<html><head><title>배달 용기 깔끔하게 뜯는 법</title></head><body>
<nav class="gnb"><a href="/">홈</a></nav>
<div class="entry-content">
  <p>배달 용기 뚜껑 뜯다가 국물 쏟은 적 있으시죠.</p>
  <p>모서리부터 한 번에 들어올리면 안 됩니다. 그러면 국물이 튑니다.</p>
  <p>긴 변 가운데를 먼저 누른 다음 천천히 밀어 올리세요.</p>
</div>
<div class="another_category"><a href="/x">다른 글 보기</a></div>
<div id="comment"><p>댓글 내용입니다</p></div>
</body></html>
"""

GENERIC_HTML = """
<html><head><title>일반 웹 글</title></head><body>
<header><a href="/a">메뉴1</a><a href="/b">메뉴2</a><a href="/c">메뉴3</a></header>
<article>
  <p>이건 평범한 웹 페이지의 본문입니다. 컨테이너 이름이 알려진 것이 아니어서 글자 밀도로 찾아야 합니다.</p>
  <p>두 번째 문단입니다. 충분히 길어야 본문으로 인식됩니다. 그래서 문장을 조금 더 붙입니다.</p>
</article>
<aside class="sidebar"><a href="/1">인기글1</a><a href="/2">인기글2</a></aside>
</body></html>
"""


# ── 주소 정규화 ───────────────────────────────────────────


def test_네이버_블로그는_모바일_주소로_바꾼다() -> None:
    assert normalize("https://blog.naver.com/weekend/223456") == "https://m.blog.naver.com/weekend/223456"


def test_네이버_쿼리_형태도_바꾼다() -> None:
    url = "https://blog.naver.com/PostView.naver?blogId=weekend&logNo=223456"
    assert normalize(url) == "https://m.blog.naver.com/weekend/223456"


def test_다른_블로그는_그대로() -> None:
    assert normalize("https://example.tistory.com/55") == "https://example.tistory.com/55"


# ── 네이버 ────────────────────────────────────────────────


def test_네이버_본문을_뽑는다() -> None:
    article = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1")
    assert article.title == "주말 당일치기 근교 산책 코스 3곳"
    assert article.blog_name == "주말 산책 기록"
    assert "강변 산책길입니다" in article.text


def test_댓글과_광고와_관련글이_섞이지_않는다() -> None:
    text = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1").text
    for junk in ("댓글", "광고입니다", "관련글", "tracking"):
        assert junk not in text, f"'{junk}' 가 본문에 섞였습니다"


def test_메뉴도_섞이지_않는다() -> None:
    text = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1").text
    assert "소개" not in text


def test_이미지를_절대_주소로_모은다() -> None:
    article = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1")
    urls = [i.url for i in article.images]
    assert "https://m.blog.naver.com/img/walk1.jpg" in urls
    assert "https://cdn.example.com/walk2.jpg" in urls


def test_이미지가_본문_어디에_있었는지_기억한다() -> None:
    article = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1")
    positions = [i.after_paragraph for i in article.images]
    assert positions == sorted(positions)
    assert positions[0] < positions[1]


def test_소제목을_따로_모은다() -> None:
    article = extract(NAVER_HTML, "https://m.blog.naver.com/weekend/1")
    assert "멀리 안 가도 되는 곳" in article.headings


# ── 티스토리 ──────────────────────────────────────────────


def test_티스토리_본문을_뽑는다() -> None:
    article = extract(TISTORY_HTML, "https://example.tistory.com/55")
    assert "긴 변 가운데를" in article.text
    assert len(article.paragraphs) == 3


def test_티스토리_댓글과_다른글은_뺀다() -> None:
    text = extract(TISTORY_HTML, "https://example.tistory.com/55").text
    assert "댓글 내용" not in text
    assert "다른 글 보기" not in text


# ── 일반 웹 ───────────────────────────────────────────────


def test_컨테이너를_모르면_글자_밀도로_찾는다() -> None:
    article = extract(GENERIC_HTML, "https://example.com/post")
    assert "평범한 웹 페이지의 본문" in article.text


def test_링크만_빽빽한_영역은_본문이_아니다() -> None:
    text = extract(GENERIC_HTML, "https://example.com/post").text
    assert "인기글1" not in text
    assert "메뉴1" not in text


# ── 공통 ──────────────────────────────────────────────────


@pytest.mark.parametrize("html", [NAVER_HTML, TISTORY_HTML, GENERIC_HTML])
def test_본문이_비어_있지_않다(html: str) -> None:
    article = extract(html, "https://example.com/x")
    assert article.char_count > 50
    assert article.paragraphs
