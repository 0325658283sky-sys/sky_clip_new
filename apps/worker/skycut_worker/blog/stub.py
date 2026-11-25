"""오프라인 스텁 — 블로그 대본용.

실제 LLM을 부르지 않고 본문 문단을 그대로 장면으로 쪼갠다.
품질은 의미 없고, 흐름과 형식만 확인한다.
"""
from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel

from .extract import ExtractedArticle
from .script import SceneOut, ShortPlanOut, ShortScriptOut, TitleOut

T = TypeVar("T", bound=BaseModel)


class BlogStubLlm:
    def __init__(self, article: ExtractedArticle, shorts: int = 1, scenes_per_short: int = 3) -> None:
        self._article = article
        self._shorts = shorts
        self._scenes = scenes_per_short

    def structured(self, step: str, system: str, user: str, output_format: type[T]) -> T:
        if output_format is not ShortPlanOut:
            raise NotImplementedError(f"블로그 스텁이 모르는 출력 형식: {output_format!r}")

        paragraphs = [p for p in self._article.paragraphs if len(p) > 10] or ["내용이 없습니다"]
        alts = [img.alt for img in self._article.images]
        head = (self._article.title or "이 글")[:10]

        shorts: list[ShortScriptOut] = []
        for s in range(self._shorts):
            scenes: list[SceneOut] = []
            for i in range(self._scenes):
                at = (s * self._scenes + i) % len(paragraphs)
                scenes.append(
                    SceneOut(
                        narration=paragraphs[at][:90],
                        image_hint=alts[at % len(alts)] if alts else "",
                        text_card="" if alts else f"스텁 카드 {i + 1}",
                    )
                )
            shorts.append(
                ShortScriptOut(
                    scenes=scenes,
                    titles=[
                        TitleOut(line1="스텁 제목", line2=f"{head} 이야기", keyword=head),
                        TitleOut(line1="두 번째 안", line2=f"{head} 정리", keyword=head),
                        TitleOut(line1="세 번째 안", line2=f"{head} 요약", keyword=head),
                    ],
                    question="여러분은 어떠세요?",
                )
            )
        return ShortPlanOut(shorts=shorts)  # type: ignore[return-value]
