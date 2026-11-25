"""STT 공급자 등록소.

M1 비교 실험에서 하나를 고르면 .env의 SKYCUT_STT_ENGINE에 넣는다.
"""
from __future__ import annotations

import os
from pathlib import Path

from .base import SttNotConfigured, Transcriber, TranscriptResult, make_words
from .compare import EngineReport, evaluate_engine, word_error_rate, write_comparison
from .fixture import FixtureTranscriber

ENGINES = ("elevenlabs", "deepgram", "fixture")

DEFAULT_ENGINE = os.getenv("SKYCUT_STT_ENGINE", "elevenlabs")


def get_transcriber(name: str, *, project_path: Path | None = None) -> Transcriber:
    if name == "fixture":
        if project_path is None:
            raise SttNotConfigured("fixture 공급자는 --from-project 로 Project JSON을 받아야 합니다.")
        return FixtureTranscriber(project_path)
    if name == "elevenlabs":
        from .elevenlabs import ElevenLabsTranscriber

        return ElevenLabsTranscriber()
    if name == "deepgram":
        from .deepgram import DeepgramTranscriber

        return DeepgramTranscriber()
    raise SttNotConfigured(f"모르는 STT 엔진: {name} (있는 것: {', '.join(ENGINES)})")


__all__ = [
    "DEFAULT_ENGINE",
    "ENGINES",
    "EngineReport",
    "FixtureTranscriber",
    "SttNotConfigured",
    "TranscriptResult",
    "Transcriber",
    "evaluate_engine",
    "get_transcriber",
    "make_words",
    "word_error_rate",
    "write_comparison",
]
