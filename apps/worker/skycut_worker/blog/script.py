"""블로그 글 → 쇼츠 대본.

원문을 그대로 읽으면 이탈한다. 핵심만 뽑아 **말하듯이 다시 쓴다.**

    0~3초 후킹 → 무엇을 알게 되는지 → 핵심 2~3개 → 마무리 한 줄

**원문에 없는 내용을 넣지 않는다.** 이건 프롬프트로만 막을 수 없어서,
만들어진 대본을 원문과 대조하는 검사를 따로 둔다(`check_grounding`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from ..korean import strip_particles
from .extract import ExtractedArticle

#: 쇼츠 하나의 목표 길이
MIN_SECONDS = 15
MAX_SECONDS = 40
#: 한국어를 읽는 대략의 속도 (초당 글자). 대본 길이를 가늠하는 데 쓴다.
CHARS_PER_SEC = 5.5


# ── LLM 출력 스키마 ────────────────────────────────────────


class SceneOut(BaseModel):
    narration: str = Field(description="이 장면에서 읽을 말 한 덩어리. 한 문장이나 두 문장.")
    image_hint: str = Field(
        default="",
        description="이 장면에 어울리는 본문 이미지의 설명이나 주변 문장. 마땅한 것이 없으면 빈 문자열",
    )
    text_card: str = Field(
        default="",
        description="이미지가 없을 때 화면에 크게 띄울 짧은 문구. 12자 이내. 필요 없으면 빈 문자열",
    )


class TitleOut(BaseModel):
    line1: str = Field(description="첫 줄: 꾸미는 말. 10~14자 이내")
    line2: str = Field(description="둘째 줄: 핵심. 10~14자 이내")
    keyword: str = Field(description="line2 안에 그대로 들어 있는 강조할 부분")


class ShortScriptOut(BaseModel):
    scenes: list[SceneOut] = Field(description="순서대로 읽을 장면들. 3~7개.")
    titles: list[TitleOut] = Field(description="제목 후보 3개")
    question: str = Field(description="시청자에게 던질 질문 한 줄. 25자 이내")


class ShortPlanOut(BaseModel):
    shorts: list[ShortScriptOut] = Field(description="이 글에서 만들 쇼츠들. 1~3개.")


# ── 내부 타입 ──────────────────────────────────────────────


@dataclass
class Scene:
    narration: str
    image_hint: str = ""
    text_card: str = ""
    image_url: str | None = None
    #: 저장소에 담긴 뒤 채워진다
    image_asset_id: str | None = None


@dataclass
class ShortScript:
    scenes: list[Scene] = field(default_factory=list)
    titles: list[tuple[str, str, str]] = field(default_factory=list)
    question: str = ""

    @property
    def narration_text(self) -> str:
        return " ".join(s.narration for s in self.scenes)

    @property
    def estimated_seconds(self) -> float:
        chars = len(self.narration_text.replace(" ", ""))
        return chars / CHARS_PER_SEC


# ── 프롬프트 ───────────────────────────────────────────────

SYSTEM = f"""\
너는 블로그 글을 세로 쇼츠 대본으로 바꾸는 편집자다.

가장 중요한 규칙: **원문에 없는 내용을 지어내지 않는다.**
숫자, 장소 이름, 가격, 효능 같은 사실은 원문에 적힌 것만 쓴다.
원문이 애매하게 말한 것을 단정해서 말하지 않는다.

대본 쓰는 법:
- 원문 문장을 그대로 옮기지 않는다. **말하듯이 다시 쓴다.** 문장은 짧게.
- 구조: 0~3초 후킹(질문이나 놀라운 사실) → 무엇을 알게 되는지 한 줄
  → 핵심 2~3개 → 마무리 한 줄
- 전체 {MIN_SECONDS}~{MAX_SECONDS}초 분량. 한국어는 1초에 대략 {CHARS_PER_SEC}글자다.
  공백을 뺀 글자 수로 {int(MIN_SECONDS * CHARS_PER_SEC)}~{int(MAX_SECONDS * CHARS_PER_SEC)}자 사이로 맞춘다.
- 한 장면은 한두 문장이다. 장면이 바뀌면 화면도 바뀐다.
- 읽었을 때 어색한 문어체("~하였다", "~라고 할 수 있다")를 쓰지 않는다.

장면마다:
- image_hint: 이 대목에 어울리는 본문 이미지를 고를 수 있게, 그 이미지의 설명이나
  근처 문장을 적는다. 마땅한 것이 없으면 비워 둔다.
- text_card: 이미지가 없을 때 화면에 크게 띄울 짧은 문구. 12자 이내.

제목:
- 두 줄. 첫 줄은 꾸미는 말, 둘째 줄은 핵심. 줄마다 10~14자 이내.
- 숫자형("3가지", "99%가 모르는")이나 질문형("~인 이유")을 우선한다.
- keyword는 둘째 줄 안에 **그대로 들어 있는 연속된 부분**이어야 한다.
- 서로 다른 각도로 3개.

글이 여러 주제를 다루면 쇼츠를 나눠도 된다(최대 3개). 주제가 하나면 1개만 만든다.
억지로 늘리지 않는다."""


def build_user_prompt(article: ExtractedArticle, max_shorts: int) -> str:
    parts = [f"제목: {article.title}"]
    if article.blog_name:
        parts.append(f"블로그: {article.blog_name}")
    if article.images:
        listed = [f"  - {img.alt or '(설명 없음)'}" for img in article.images[:12]]
        parts.append("본문에 있는 이미지:\n" + "\n".join(listed))
    parts.append(f"쇼츠는 최대 {max_shorts}개까지.")
    parts.append("\n본문:\n" + article.text[:12_000])
    return "\n".join(parts)


# ── 원문 대조 ──────────────────────────────────────────────

_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


@dataclass
class GroundingIssue:
    kind: str
    detail: str


def check_grounding(script: ShortScript, article: ExtractedArticle) -> list[GroundingIssue]:
    """대본이 원문에 없는 말을 하는지 본다.

    완벽한 검사는 아니다. **숫자**와 **낯선 고유어**를 잡아내는 수준이고,
    걸린 것은 사람이 확인하라는 신호다.
    """
    issues: list[GroundingIssue] = []
    source = article.text + " " + article.title
    source_numbers = set(_NUMBER.findall(source))
    source_stems = {strip_particles(w) for w in source.split()}
    source_stems.discard("")

    narration = script.narration_text
    for number in set(_NUMBER.findall(narration)):
        if number not in source_numbers:
            issues.append(GroundingIssue("number", f"원문에 없는 숫자 '{number}'"))

    for title_line1, title_line2, _ in script.titles:
        for number in set(_NUMBER.findall(f"{title_line1} {title_line2}")):
            if number not in source_numbers:
                issues.append(GroundingIssue("number", f"제목에 원문에 없는 숫자 '{number}'"))

    # 조사를 떼고도 원문에 전혀 없는 긴 단어는 지어낸 고유명사일 수 있다
    for word in narration.split():
        stem = strip_particles(word)
        if len(stem) >= 4 and stem not in source_stems and not _NUMBER.search(stem):
            issues.append(GroundingIssue("unknown_word", f"원문에 없는 말 '{word}'"))

    return issues


def pick_images(script: ShortScript, article: ExtractedArticle) -> None:
    """장면마다 가장 어울리는 본문 이미지를 붙인다.

    image_hint와 이미지 설명이 겹치는 정도로 고르고, 없으면 본문에 나온
    순서대로 나눠 준다. 한 이미지를 두 장면에 쓰지 않는다.
    """
    available = list(article.images)
    if not available:
        return

    used: set[int] = set()

    def best_match(hint: str) -> int | None:
        if not hint:
            return None
        hint_stems = {strip_particles(w) for w in hint.split() if len(w) > 1}
        best, best_score = None, 0
        for i, img in enumerate(available):
            if i in used or not img.alt:
                continue
            alt_stems = {strip_particles(w) for w in img.alt.split() if len(w) > 1}
            score = len(hint_stems & alt_stems)
            if score > best_score:
                best, best_score = i, score
        return best

    # 1차: 설명이 겹치는 것
    for scene in script.scenes:
        at = best_match(scene.image_hint)
        if at is not None:
            used.add(at)
            scene.image_url = available[at].url

    # 2차: 남은 장면에 본문 순서대로
    leftovers = [i for i in range(len(available)) if i not in used]
    for scene in script.scenes:
        if scene.image_url or not leftovers:
            continue
        at = leftovers.pop(0)
        used.add(at)
        scene.image_url = available[at].url

    # 이미지도 텍스트 카드도 없으면 나레이션 앞부분으로 카드를 만든다
    for scene in script.scenes:
        if not scene.image_url and not scene.text_card:
            scene.text_card = _short_card(scene.narration)


def _short_card(narration: str) -> str:
    words = narration.replace("?", "").replace(".", "").split()
    card = ""
    for word in words:
        candidate = f"{card} {word}".strip()
        if len(candidate) > 12:
            break
        card = candidate
    return card or narration[:12]
