"""오프라인 스텁 STT.

**실제로 받아쓰지 않는다.** 오디오 길이에 맞춰 그럴듯한 한국어 대본을
만들어 낼 뿐이다. API 키 없이 전체 흐름(에셋 → 대본 → 하이라이트 → 렌더)을
끝까지 돌려 보기 위한 것이다.

같은 길이의 오디오에는 항상 같은 대본을 돌려주므로 테스트에 쓸 수 있다.
"""
from __future__ import annotations

from pathlib import Path

from ..media.ffmpeg import probe
from .base import TranscriptResult, make_words

#: 돌려 쓸 문장들. 문장 끝 어미가 있어야 문장 경계 추정이 동작한다.
_SENTENCES: tuple[str, ...] = (
    "자취를 오래 하면서 제일 많이 들은 질문이 하나 있는데요",
    "정답은 생각보다 훨씬 단순합니다",
    "처음부터 한꺼번에 넣지 마세요",
    "반만 먼저 넣고 나중에 나머지를 넣으면 됩니다",
    "그러면 향이 날아가지 않아서 맛이 완전히 달라져요",
    "이건 오늘 바로 해 보실 수 있는 방법이에요",
    "어 그러니까 제 말은 순서가 중요하다는 거예요",
    "한 번만 따라 해 보시면 차이를 바로 느끼실 겁니다",
)

#: 어절 하나당 대략 이 정도 걸린다고 본다
MS_PER_CHAR = 120
GAP_MS = 70


class StubTranscriber:
    name = "stub"

    def transcribe(self, audio_path: Path, language: str = "ko") -> TranscriptResult:
        duration_ms = int(probe(audio_path).duration_ms) if audio_path.exists() else 0
        if duration_ms <= 0:
            return TranscriptResult(engine=self.name, words=[], audio_seconds=0.0)

        items: list[tuple[str, float, float]] = []
        cursor = 0
        index = 0
        while cursor < duration_ms:
            sentence = _SENTENCES[index % len(_SENTENCES)]
            index += 1
            for token in sentence.split():
                span = max(200, len(token) * MS_PER_CHAR)
                if cursor + span > duration_ms:
                    cursor = duration_ms
                    break
                items.append((token, cursor / 1000, (cursor + span) / 1000))
                cursor += span + GAP_MS

        words = make_words(items)
        return TranscriptResult(
            engine=self.name,
            words=words,
            audio_seconds=duration_ms / 1000,
            wall_seconds=0.0,
            usd=0.0,
        )
