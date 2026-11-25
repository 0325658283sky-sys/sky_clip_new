"""이미 대본이 들어 있는 Project JSON에서 읽어 오는 공급자.

API 키 없이 뒷단(하이라이트·평가)을 개발하고 테스트하기 위한 것.
"""
from __future__ import annotations

import json
from pathlib import Path

from ..transcript import Word
from .base import TranscriptResult


class FixtureTranscriber:
    name = "fixture"

    def __init__(self, project_path: Path) -> None:
        self._path = project_path

    def transcribe(self, audio_path: Path, language: str = "ko") -> TranscriptResult:
        raw = json.loads(self._path.read_text(encoding="utf-8"))
        transcript = raw.get("transcript") or {}
        words = [
            Word(
                id=w["id"],
                text=w["text"],
                start_ms=w["startMs"],
                end_ms=w["endMs"],
                speaker_id=w.get("speakerId"),
                confidence=w.get("confidence"),
            )
            for w in transcript.get("words", [])
        ]
        audio_seconds = (words[-1].end_ms / 1000) if words else 0.0
        return TranscriptResult(
            engine=self.name,
            words=words,
            audio_seconds=audio_seconds,
            wall_seconds=0.0,
            usd=0.0,
        )
