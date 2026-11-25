"""ElevenLabs Scribe (speech-to-text).

REST로 직접 부른다. 요청·응답 모양은 공식 문서에서 확인한 것이다
(https://elevenlabs.io/docs/api-reference/speech-to-text/convert):

  POST https://api.elevenlabs.io/v1/speech-to-text   (multipart/form-data)
  헤더   xi-api-key
  폼     file, model_id, language_code, timestamps_granularity, diarize
  응답   { "text": ..., "words": [ {text, type, start, end, speaker_id, logprob} ] }
         start/end 단위는 **초**. type이 "word"인 것만 단어다
         ("spacing"은 단어 사이 공백, "audio_event"는 소리 이벤트).
         confidence 필드는 없고 logprob(-무한대~0)만 있다.

문서 기준 한국어는 Scribe v2에서 WER 10~20% 구간("Good")이다.
"""
from __future__ import annotations

import math
import os
import time
from pathlib import Path

from .base import SttNotConfigured, TranscriptResult, make_words

ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text"
DEFAULT_MODEL = os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2")

#: 시간당 요금. 공식 문서에 숫자가 없어 비워 둔다.
#: 가입 후 요금 페이지에서 확인해 .env의 ELEVENLABS_USD_PER_HOUR에 넣으면 비용이 집계된다.
USD_PER_HOUR = float(os.getenv("ELEVENLABS_USD_PER_HOUR", "0") or 0)


class ElevenLabsTranscriber:
    name = "elevenlabs"

    def __init__(self, api_key: str | None = None, model_id: str = DEFAULT_MODEL) -> None:
        self._key = api_key or os.getenv("ELEVENLABS_API_KEY")
        if not self._key:
            raise SttNotConfigured(
                "ELEVENLABS_API_KEY가 없습니다. 저장소 루트 .env에 넣으세요."
            )
        self._model_id = model_id

    def transcribe(self, audio_path: Path, language: str = "ko") -> TranscriptResult:
        import httpx  # anthropic이 이미 가져오는 패키지

        data = {
            "model_id": self._model_id,
            # 문서상 ISO-639-1("ko")과 ISO-639-3("kor") 모두 받는다
            "language_code": language,
            # 단어 단위 타임스탬프를 받으려면 반드시 필요하다
            "timestamps_granularity": "word",
            "diarize": "true",
        }

        started = time.monotonic()
        with audio_path.open("rb") as fh:
            response = httpx.post(
                ENDPOINT,
                headers={"xi-api-key": self._key},
                data=data,
                files={"file": (audio_path.name, fh)},
                timeout=httpx.Timeout(600.0, connect=30.0),
            )
        elapsed = time.monotonic() - started
        response.raise_for_status()
        payload = response.json()

        if "words" not in payload and "transcripts" in payload:
            raise RuntimeError(
                "멀티채널 응답을 받았습니다. 모노 오디오로 변환해 다시 시도하세요."
            )

        entries = [w for w in payload.get("words", []) if w.get("type") == "word"]
        items: list[tuple[str, float, float]] = []
        speakers: list[str | None] = []
        confidences: list[float | None] = []
        for w in entries:
            start, end = w.get("start"), w.get("end")
            if start is None or end is None:
                continue  # 타임스탬프가 없는 조각은 쓸 수 없다
            items.append((str(w.get("text", "")).strip(), float(start), float(end)))
            speakers.append(w.get("speaker_id"))
            confidences.append(_confidence_from_logprob(w.get("logprob")))

        words = make_words(items, speakers, confidences)
        audio_seconds = words[-1].end_ms / 1000 if words else 0.0

        return TranscriptResult(
            engine=self.name,
            words=words,
            audio_seconds=audio_seconds,
            wall_seconds=elapsed,
            usd=USD_PER_HOUR * audio_seconds / 3600,
            raw=payload,
        )


def _confidence_from_logprob(logprob: object) -> float | None:
    """logprob(-무한대~0)을 0~1로 바꾼다. 비교용 근사값일 뿐이다."""
    if not isinstance(logprob, (int, float)):
        return None
    return round(min(1.0, math.exp(float(logprob))), 4)
