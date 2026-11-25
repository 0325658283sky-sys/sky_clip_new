"""Deepgram (pre-recorded).

공식 문서에서 확인한 것
(https://developers.deepgram.com/docs/pre-recorded-audio):

  from deepgram import DeepgramClient
  deepgram = DeepgramClient(api_key=...)
  response = deepgram.listen.v1.media.transcribe_file(request=<bytes>, model="nova-3", smart_format=True)

  응답: results.channels[0].alternatives[0].words
        각 단어: word, start, end, confidence, punctuated_word
        start/end 단위는 **초**
        문장 경계: results.channels[0].alternatives[0].paragraphs

**확인하지 못한 것**: 한국어(`language`), 화자 분리(`diarize`), 문장부호(`punctuate`)
파라미터 이름은 참조 문서(404)에서 확인하지 못했다. 아래 이름으로 보내되,
공급자가 받지 않으면 무엇을 고쳐야 하는지 알려 주고 멈춘다.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from .base import SttNotConfigured, TranscriptResult, make_words

DEFAULT_MODEL = os.getenv("DEEPGRAM_MODEL", "nova-3")

#: 분당 요금. 공식 문서에 숫자가 없어 비워 둔다. .env의 DEEPGRAM_USD_PER_MINUTE로 넣는다.
USD_PER_MINUTE = float(os.getenv("DEEPGRAM_USD_PER_MINUTE", "0") or 0)

#: 참조 문서에서 확인하지 못한 파라미터들. 첫 실행에서 거부되면 이름을 고친다.
UNVERIFIED_OPTIONS = ("language", "diarize", "punctuate")


class DeepgramTranscriber:
    name = "deepgram"

    def __init__(self, api_key: str | None = None, model: str = DEFAULT_MODEL) -> None:
        self._key = api_key or os.getenv("DEEPGRAM_API_KEY")
        if not self._key:
            raise SttNotConfigured("DEEPGRAM_API_KEY가 없습니다. 저장소 루트 .env에 넣으세요.")
        self._model = model

    def transcribe(self, audio_path: Path, language: str = "ko") -> TranscriptResult:
        try:
            from deepgram import DeepgramClient
        except ModuleNotFoundError as exc:
            raise SttNotConfigured(
                "deepgram-sdk가 설치돼 있지 않습니다:  pip install 'skycut-worker[deepgram]'"
            ) from exc

        client = DeepgramClient(api_key=self._key)
        payload_bytes = audio_path.read_bytes()

        options = {
            "model": self._model,
            "smart_format": True,
            "language": language,
            "diarize": True,
            "punctuate": True,
        }

        started = time.monotonic()
        try:
            response = client.listen.v1.media.transcribe_file(request=payload_bytes, **options)
        except TypeError as exc:
            raise SttNotConfigured(
                f"Deepgram이 받지 않는 파라미터가 있습니다: {exc}\n"
                f"확인하지 못한 이름: {', '.join(UNVERIFIED_OPTIONS)}\n"
                "https://developers.deepgram.com/docs/language 에서 정확한 이름을 보고 "
                "skycut_worker/stt/deepgram.py의 options를 고치세요."
            ) from exc
        elapsed = time.monotonic() - started

        payload = response.to_json() if hasattr(response, "to_json") else response
        data = _as_dict(payload)
        alt = _first_alternative(data)

        items: list[tuple[str, float, float]] = []
        speakers: list[str | None] = []
        confidences: list[float | None] = []
        for w in alt.get("words", []):
            # 문장부호가 붙은 형태가 있으면 그쪽이 자막에 쓰기 좋다
            text = str(w.get("punctuated_word") or w.get("word") or "").strip()
            if not text:
                continue
            items.append((text, float(w["start"]), float(w["end"])))
            spk = w.get("speaker")
            speakers.append(f"speaker_{spk}" if spk is not None else None)
            conf = w.get("confidence")
            confidences.append(float(conf) if isinstance(conf, (int, float)) else None)

        words = make_words(items, speakers, confidences)
        audio_seconds = _duration_of(data) or (words[-1].end_ms / 1000 if words else 0.0)

        return TranscriptResult(
            engine=self.name,
            words=words,
            audio_seconds=audio_seconds,
            wall_seconds=elapsed,
            usd=USD_PER_MINUTE * audio_seconds / 60,
            sentence_bounds=[],
            raw=data,
        )


def _as_dict(payload: object) -> dict:
    import json

    if isinstance(payload, dict):
        return payload
    if isinstance(payload, (str, bytes)):
        return json.loads(payload)
    if hasattr(payload, "model_dump"):
        return payload.model_dump()  # type: ignore[no-any-return]
    raise RuntimeError(f"Deepgram 응답을 해석할 수 없습니다: {type(payload)!r}")


def _first_alternative(data: dict) -> dict:
    try:
        return data["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(
            "Deepgram 응답에서 results.channels[0].alternatives[0]를 찾지 못했습니다."
        ) from exc


def _duration_of(data: dict) -> float:
    meta = data.get("metadata") or {}
    value = meta.get("duration")
    return float(value) if isinstance(value, (int, float)) else 0.0
