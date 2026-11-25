"""블로그 주소 → 나레이션 쇼츠.

    글 가져오기 → 본문 추출 → 대본 쓰기 → 이미지 붙이기 → 나레이션 → 조립

자막을 음성에 맞추는 것이 핵심이라, 장면 길이는 TTS가 돌려준 실제 길이를 쓴다.
추정값을 쓰지 않는다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..config import RunConfig
from ..cost import CostReport, TtsUsage
from ..highlight.llm import LlmClient
from ..media.store import MediaStore
from ..tts import NarrationCache, Synthesizer, VoiceSpec
from . import script as script_mod
from .extract import ExtractedArticle, extract
from .fetch import FetchedPage, fetch
from .images import StoredImage, download_images
from .script import GroundingIssue, Scene, ShortPlanOut, ShortScript, check_grounding, pick_images

Progress = Callable[[str], None]


@dataclass
class NarratedShort:
    script: ShortScript
    scene_ids: list[str] = field(default_factory=list)
    scene_durations_ms: list[int] = field(default_factory=list)
    scene_word_timings: list[list[tuple[str, int, int]]] = field(default_factory=list)
    tts_asset_ids: list[str] = field(default_factory=list)
    grounding: list[GroundingIssue] = field(default_factory=list)

    @property
    def duration_ms(self) -> int:
        return sum(self.scene_durations_ms)


@dataclass
class BlogResult:
    article: ExtractedArticle
    page: FetchedPage
    shorts: list[NarratedShort] = field(default_factory=list)
    assets: dict[str, dict] = field(default_factory=dict)
    tts_usd: float = 0.0
    reused_narration: int = 0

    def report(self) -> str:
        lines = [
            f"본문 {self.article.char_count}자 · 문단 {len(self.article.paragraphs)}개 · "
            f"이미지 {len(self.article.images)}개 → 쇼츠 {len(self.shorts)}개"
        ]
        for i, short in enumerate(self.shorts, 1):
            title = short.script.titles[0] if short.script.titles else ("", "", "")
            lines.append(
                f"  쇼츠 {i}: {short.duration_ms / 1000:.1f}초 · 장면 {len(short.script.scenes)}개"
                f"  {title[0]} {title[1]}"
            )
            if short.grounding:
                kinds = {g.kind for g in short.grounding}
                lines.append(f"    ⚠ 원문 대조에 걸린 것 {len(short.grounding)}개 ({', '.join(sorted(kinds))}) — 사람이 확인하세요")
        if self.reused_narration:
            lines.append(f"  나레이션 {self.reused_narration}개는 이미 만든 것을 다시 씀")
        return "\n".join(lines)


def load_article(url: str, on_progress: Progress | None = None) -> tuple[FetchedPage, ExtractedArticle]:
    """글을 한 번만 받아 본문을 뽑는다."""
    say = on_progress or (lambda _: None)
    say("글 가져오는 중")
    page = fetch(url)
    article = extract(page.html, page.final_url)
    say(f"  {article.title[:40]} · 본문 {article.char_count}자 · 이미지 {len(article.images)}개")
    return page, article


def build_shorts(
    url: str,
    llm: LlmClient,
    synth: Synthesizer,
    store: MediaStore,
    cfg: RunConfig,
    *,
    voice: VoiceSpec | None = None,
    max_shorts: int = 3,
    on_progress: Progress | None = None,
    loaded: tuple[FetchedPage, ExtractedArticle] | None = None,
) -> BlogResult:
    say = on_progress or (lambda _: None)

    # 이미 받아 둔 글이 있으면 다시 받지 않는다 (오프라인 모드가 그렇다)
    page, article = loaded if loaded else load_article(url, say)
    if article.char_count < 200:
        raise ValueError(
            f"본문이 너무 짧아요 ({article.char_count}자). 글 주소가 맞는지 확인해 주세요."
        )

    say("대본 쓰는 중")
    plan = llm.structured(
        "blog_script",
        script_mod.SYSTEM,
        script_mod.build_user_prompt(article, max_shorts),
        ShortPlanOut,
    )

    scripts: list[ShortScript] = []
    for out in plan.shorts[:max_shorts]:
        titles: list[tuple[str, str, str]] = []
        for t in out.titles[:3]:
            line2 = t.line2.strip()
            keyword = t.keyword.strip()
            titles.append((t.line1.strip(), line2, keyword if keyword and keyword in line2 else ""))
        scripts.append(
            ShortScript(
                scenes=[
                    Scene(
                        narration=s.narration.strip(),
                        image_hint=s.image_hint.strip(),
                        text_card=s.text_card.strip(),
                    )
                    for s in out.scenes
                    if s.narration.strip()
                ],
                titles=titles,
                question=out.question.strip(),
            )
        )
    scripts = [s for s in scripts if s.scenes]
    if not scripts:
        raise ValueError("대본을 만들지 못했어요. 글이 너무 짧거나 내용이 없을 수 있어요.")

    say("이미지 가져오는 중")
    wanted = [img.url for img in article.images]
    stored: dict[str, StoredImage] = download_images(wanted, store, referer=page.final_url) if wanted else {}
    # 못 가져온 이미지는 후보에서 뺀다 (텍스트 카드로 대체된다)
    article.images = [img for img in article.images if img.url in stored]
    say(f"  {len(stored)}개 사용 가능")

    for s in scripts:
        pick_images(s, article)

    say("나레이션 만드는 중")
    cache = NarrationCache(store)
    voice_spec = voice or synth.default_voice
    assets: dict[str, dict] = {}
    shorts: list[NarratedShort] = []
    total_usd = 0.0
    reused = 0

    for s in scripts:
        short = NarratedShort(script=s, grounding=check_grounding(s, article))
        for index, scene in enumerate(s.scenes, 1):
            narration = cache.synthesize(synth, scene.narration, voice_spec)
            total_usd += narration.usd
            reused += 1 if narration.reused else 0

            short.scene_ids.append(f"s{index}")
            short.scene_durations_ms.append(narration.duration_ms)
            short.scene_word_timings.append([(w.text, w.start_ms, w.end_ms) for w in narration.words])
            short.tts_asset_ids.append(narration.asset_id)
            assets[narration.asset_id] = dict(narration.asset)

            if scene.image_url and scene.image_url in stored:
                image = stored[scene.image_url]
                scene.image_asset_id = image.asset_id
                assets[image.asset_id] = dict(image.asset)
        shorts.append(short)

    return BlogResult(
        article=article,
        page=page,
        shorts=shorts,
        assets=assets,
        tts_usd=total_usd,
        reused_narration=reused,
    )


def record_cost(result: BlogResult, report: CostReport, provider: str) -> None:
    chars = sum(len(scene.narration) for short in result.shorts for scene in short.script.scenes)
    report.tts = TtsUsage(provider=provider, characters=chars, usd=result.tts_usd)
