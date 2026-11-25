"""유튜브 댓글 정리와 작성자 가리기.

**AI가 지어낸 문장을 댓글처럼 보여 주지 않는다**는 규칙을 코드로 지킨다.
"""
from __future__ import annotations

import pytest

from skycut_worker.comments import Comment, clean_text, is_usable, mask_author
from skycut_worker.config import ExtractionRequest, RunConfig
from skycut_worker.project_io import candidate_to_clip
from skycut_worker.highlight.types import Candidate
from skycut_worker.transcript import TranscriptView, Word


@pytest.fixture
def view() -> TranscriptView:
    return TranscriptView(
        [
            Word(id=f"w{i}", text=t, start_ms=i * 600, end_ms=i * 600 + 500)
            for i, t in enumerate(["물은", "종이컵", "세", "컵이면", "충분합니다"])
        ]
    )


# ── 작성자 가리기 ─────────────────────────────────────────


def test_작성자_이름을_가린다() -> None:
    assert mask_author("@홍길동") == "홍○○"
    assert mask_author("김") == "김○"


def test_빈_이름은_시청자로() -> None:
    assert mask_author("   ") == "시청자"


def test_긴_이름도_네_글자를_넘지_않는다() -> None:
    assert len(mask_author("아주아주긴닉네임입니다")) <= 4


# ── 본문 정리 ─────────────────────────────────────────────


def test_html과_링크를_걷어낸다() -> None:
    assert clean_text("재밌네요 <br> https://spam.example.com 봐주세요") == "재밌네요 봐주세요"


def test_엔티티를_풀어도_태그로_남지_않는다() -> None:
    """&lt;b&gt;를 풀면 <b>가 되는데, 그대로 두면 화면에 태그가 들어간다."""
    assert clean_text("&lt;b&gt;굵게&lt;/b&gt;") == "굵게"
    assert clean_text("&amp; 그리고") == "& 그리고"


# ── 쓸 만한 댓글 고르기 ───────────────────────────────────


def test_한국어가_없으면_쓰지_않는다() -> None:
    assert not is_usable("nice video thanks")


def test_너무_길면_쓰지_않는다() -> None:
    assert not is_usable("가" * 100)


def test_타임스탬프만_적은_댓글은_쓰지_않는다() -> None:
    assert not is_usable("1:23 4:56")


def test_구독_요청은_쓰지_않는다() -> None:
    assert not is_usable("구독하고 갑니다")


def test_평범한_한국어_댓글은_쓴다() -> None:
    assert is_usable("이거 진짜 유용하네요 감사합니다")


# ── 하단 카드 ─────────────────────────────────────────────


def test_실제_댓글이_있으면_댓글_카드를_쓴다(view: TranscriptView) -> None:
    cand = Candidate(0, 4, summary="요약 문장")
    comment = Comment(text="이거 진짜 꿀팁이네요", author_masked="김○○", likes=42)
    clip = candidate_to_clip(view, cand, "c1", "a-black", None, comment)
    card = clip["content"]["bottomCard"]
    assert card["kind"] == "real_comment"
    assert card["text"] == "이거 진짜 꿀팁이네요"
    assert card["authorMasked"] == "김○○"


def test_댓글이_없으면_한줄_요약을_쓴다(view: TranscriptView) -> None:
    """AI가 쓴 문장은 요약 카드로만 나간다. 댓글인 척하지 않는다."""
    cand = Candidate(0, 4, summary="물은 종이컵 3컵")
    clip = candidate_to_clip(view, cand, "c1", "a-black", None, None)
    card = clip["content"]["bottomCard"]
    assert card["kind"] == "summary"
    assert "authorMasked" not in card


def test_댓글이_모자라면_나머지는_요약_카드(view: TranscriptView) -> None:
    from skycut_worker.project_io import attach_clips

    project = {
        "schemaVersion": 1,
        "id": "p",
        "createdAt": "2026-11-25T00:00:00Z",
        "input": {"kind": "upload", "rightsAttested": True},
        "assets": {},
        "clips": [],
        "provenance": {},
    }
    cands = [Candidate(0, 4, summary=f"요약 {i}") for i in range(3)]
    cfg = RunConfig(request=ExtractionRequest(), offline=True)
    out = attach_clips(
        project,
        view,
        cands,
        cfg,
        comments=[Comment(text="첫 댓글이에요", author_masked="김○○", likes=1)],
    )
    kinds = [c["content"]["bottomCard"]["kind"] for c in out["clips"]]
    assert kinds == ["real_comment", "summary", "summary"]
