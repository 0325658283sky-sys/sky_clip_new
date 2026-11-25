"""블로그 → 나레이션 쇼츠.

**M3 Gate**
- 쇼츠 길이 15~40초
- 자막·장면이 나레이션과 어긋나지 않음
- 원문에 없는 사실이 대본에 들어가지 않음
"""
from __future__ import annotations

import pytest

from skycut_worker.blog.extract import ExtractedArticle, ExtractedImage
from skycut_worker.blog.script import (
    MAX_SECONDS,
    MIN_SECONDS,
    Scene,
    ShortPlanOut,
    ShortScript,
    check_grounding,
    pick_images,
)
from skycut_worker.blog.stub import BlogStubLlm
from skycut_worker.config import ExtractionRequest, RunConfig
from skycut_worker.media import MediaStore
from skycut_worker.project_io import narrated_clip
from skycut_worker.schema_models import Project
from skycut_worker.tts import NarrationCache, VoiceSpec, get_synthesizer
from skycut_worker.tts.base import group_characters_into_words, spread_words


@pytest.fixture
def article() -> ExtractedArticle:
    return ExtractedArticle(
        title="주말 당일치기 근교 산책 코스 3곳",
        blog_name="주말 산책 기록",
        paragraphs=[
            "주말에 멀리 나가기는 부담스러울 때가 있죠.",
            "첫 번째는 강변 산책길입니다. 평지라서 걷기 편합니다.",
            "두 번째는 숲길 코스예요. 나무 그늘이 많습니다.",
            "세 번째는 호수 둘레길입니다. 한 바퀴에 40분 걸려요.",
        ],
        images=[
            ExtractedImage(url="https://x/1.jpg", alt="강변 산책길 입구", after_paragraph=1),
            ExtractedImage(url="https://x/2.jpg", alt="숲길 나무 그늘", after_paragraph=2),
        ],
    )


# ── 원문 대조 ─────────────────────────────────────────────


def test_원문에_있는_숫자는_통과한다(article: ExtractedArticle) -> None:
    script = ShortScript(scenes=[Scene(narration="호수 둘레길은 한 바퀴에 40분 걸려요")])
    assert not [i for i in check_grounding(script, article) if i.kind == "number"]


def test_지어낸_숫자를_잡아낸다(article: ExtractedArticle) -> None:
    script = ShortScript(scenes=[Scene(narration="호수 둘레길은 한 바퀴에 95분 걸려요")])
    issues = [i for i in check_grounding(script, article) if i.kind == "number"]
    assert issues and "95" in issues[0].detail


def test_제목에_지어낸_숫자도_잡아낸다(article: ExtractedArticle) -> None:
    script = ShortScript(titles=[("무려", "7곳이나 됩니다", "7곳")])
    issues = [i for i in check_grounding(script, article) if i.kind == "number"]
    assert issues and "7" in issues[0].detail


def test_원문에_없는_말을_잡아낸다(article: ExtractedArticle) -> None:
    script = ShortScript(scenes=[Scene(narration="케이블카를 타면 더 빠릅니다")])
    issues = [i for i in check_grounding(script, article) if i.kind == "unknown_word"]
    assert issues


def test_원문_표현을_다시_쓴_것은_통과한다(article: ExtractedArticle) -> None:
    """말투를 바꾼 것은 지어낸 것이 아니다."""
    script = ShortScript(scenes=[Scene(narration="첫 번째는 강변 산책길입니다")])
    assert not check_grounding(script, article)


# ── 이미지 배치 ───────────────────────────────────────────


def test_설명이_겹치는_이미지를_고른다(article: ExtractedArticle) -> None:
    script = ShortScript(
        scenes=[
            Scene(narration="숲길 이야기", image_hint="숲길 나무 그늘"),
            Scene(narration="강변 이야기", image_hint="강변 산책길 입구"),
        ]
    )
    pick_images(script, article)
    assert script.scenes[0].image_url == "https://x/2.jpg"
    assert script.scenes[1].image_url == "https://x/1.jpg"


def test_한_이미지를_두_장면에_쓰지_않는다(article: ExtractedArticle) -> None:
    script = ShortScript(scenes=[Scene(narration=f"장면 {i}", image_hint="강변 산책길") for i in range(3)])
    pick_images(script, article)
    used = [s.image_url for s in script.scenes if s.image_url]
    assert len(used) == len(set(used))


def test_이미지가_모자라면_텍스트_카드로_채운다(article: ExtractedArticle) -> None:
    script = ShortScript(scenes=[Scene(narration=f"장면 {i} 내용입니다") for i in range(4)])
    pick_images(script, article)
    carded = [s for s in script.scenes if not s.image_url]
    assert len(carded) == 2
    assert all(s.text_card for s in carded)
    assert all(len(s.text_card) <= 12 for s in carded)


def test_이미지가_하나도_없으면_모두_카드() -> None:
    empty = ExtractedArticle(title="t", paragraphs=["본문"], images=[])
    script = ShortScript(scenes=[Scene(narration="아주 긴 나레이션 문장입니다 정말로")])
    pick_images(script, empty)
    assert script.scenes[0].image_url is None


# ── TTS 타이밍 ────────────────────────────────────────────


def test_글자_단위를_어절로_묶는다() -> None:
    """ElevenLabs는 글자 단위만 준다."""
    words = group_characters_into_words(
        ["안", "녕", " ", "하", "세", "요"],
        [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
        [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    )
    assert [w.text for w in words] == ["안녕", "하세요"]
    assert words[0].start_ms == 0
    assert words[1].end_ms == 600


def test_시간_정보가_없으면_글자수로_나눈다() -> None:
    words = spread_words("하나 둘 셋", 3000)
    assert [w.text for w in words] == ["하나", "둘", "셋"]
    assert words[0].start_ms == 0
    assert all(w.end_ms > w.start_ms for w in words)


def test_같은_대본은_다시_만들지_않는다(tmp_path) -> None:
    store = MediaStore(tmp_path / "store")
    cache = NarrationCache(store)
    synth = get_synthesizer("stub")
    voice = VoiceSpec(voice_id="v", model="m")

    first = cache.synthesize(synth, "안녕하세요 반갑습니다", voice)
    again = cache.synthesize(synth, "안녕하세요 반갑습니다", voice)
    assert not first.reused
    assert again.reused
    assert again.asset_id == first.asset_id
    assert [w.text for w in again.words] == [w.text for w in first.words]


def test_목소리가_바뀌면_다시_만든다(tmp_path) -> None:
    store = MediaStore(tmp_path / "store")
    cache = NarrationCache(store)
    synth = get_synthesizer("stub")

    a = cache.synthesize(synth, "같은 말", VoiceSpec(voice_id="v1", model="m"))
    b = cache.synthesize(synth, "같은 말", VoiceSpec(voice_id="v2", model="m"))
    assert a.asset_id != b.asset_id


def test_속도가_바뀌면_다시_만든다(tmp_path) -> None:
    store = MediaStore(tmp_path / "store")
    cache = NarrationCache(store)
    synth = get_synthesizer("stub")

    a = cache.synthesize(synth, "같은 말", VoiceSpec(voice_id="v", model="m", speed=1.0))
    b = cache.synthesize(synth, "같은 말", VoiceSpec(voice_id="v", model="m", speed=1.3))
    assert a.asset_id != b.asset_id
    assert b.duration_ms < a.duration_ms  # 빠르게 읽으면 짧아진다


# ── 조립 ──────────────────────────────────────────────────


class _FakeShort:
    """blog.pipeline.NarratedShort 대신 쓰는 최소 객체."""

    def __init__(self, script: ShortScript) -> None:
        self.script = script
        self.scene_ids = [f"s{i + 1}" for i in range(len(script.scenes))]
        self.scene_durations_ms = [4000] * len(script.scenes)
        self.scene_word_timings = [
            [(w, j * 500, j * 500 + 400) for j, w in enumerate(s.narration.split())]
            for s in script.scenes
        ]
        self.tts_asset_ids = [f"tts-key{i}" for i in range(len(script.scenes))]

    @property
    def duration_ms(self) -> int:
        return sum(self.scene_durations_ms)


def test_조립한_클립이_스키마를_통과한다(article: ExtractedArticle) -> None:
    script = ShortScript(
        scenes=[Scene(narration="첫 장면입니다"), Scene(narration="둘째 장면입니다")],
        titles=[("주말 당일치기", "딱 3곳만 기억하세요", "3곳")],
        question="여러분의 장소는?",
    )
    pick_images(script, article)
    for scene in script.scenes:
        if scene.image_url:
            scene.image_asset_id = "img-test"

    clip = narrated_clip(_FakeShort(script), "c1", "b-white", {"channelName": "주말 산책 기록"})
    project = {
        "schemaVersion": 1,
        "id": "p",
        "createdAt": "2026-11-25T00:00:00Z",
        "input": {"kind": "blog", "rightsAttested": True},
        "assets": {},
        "clips": [clip],
        "provenance": {},
    }
    Project.model_validate(project)

    assert clip["content"]["kind"] == "narrated_story"
    assert clip["content"]["bottomCard"]["kind"] == "question"
    assert clip["narrationDurationMs"] == 8000
    assert len(clip["generated"]) == 2


def test_장면_길이는_TTS_실제_길이를_쓴다(article: ExtractedArticle) -> None:
    """추정값을 쓰면 자막이 어긋난다."""
    script = ShortScript(scenes=[Scene(narration="한 문장")])
    short = _FakeShort(script)
    short.scene_durations_ms = [7777]
    clip = narrated_clip(short, "c1", "b-white", None)
    assert clip["generated"][0]["durationMs"] == 7777
    assert clip["narrationDurationMs"] == 7777


def test_키워드가_둘째_줄에_없으면_강조를_넣지_않는다() -> None:
    script = ShortScript(scenes=[Scene(narration="본문")], titles=[("첫 줄", "둘째 줄", "없는말")])
    clip = narrated_clip(_FakeShort(script), "c1", "b-white", None)
    assert "keywordSpan" not in clip["content"]["titles"][0]


# ── 스텁 ──────────────────────────────────────────────────


def test_스텁이_길이_범위_안의_대본을_만든다(article: ExtractedArticle) -> None:
    out = BlogStubLlm(article).structured("blog_script", "", "", ShortPlanOut)
    assert out.shorts
    script = ShortScript(
        scenes=[Scene(narration=s.narration) for s in out.shorts[0].scenes],
        titles=[(t.line1, t.line2, t.keyword) for t in out.shorts[0].titles],
    )
    assert MIN_SECONDS * 0.4 <= script.estimated_seconds <= MAX_SECONDS * 1.5


def test_설정이_반영된다() -> None:
    cfg = RunConfig(request=ExtractionRequest(max_clips=2), offline=True)
    assert cfg.request.max_clips == 2
