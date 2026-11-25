"""M1 STT 비교 실험.

같은 오디오를 여러 엔진에 넣고 네 가지를 잰다.
  1. 오인식률(WER) — 사람이 고친 기준 대본과 비교
  2. 단어 시간 정확도 — 기준 대본에 시간이 있을 때만
  3. 처리 속도 — 음성 길이 대비
  4. 비용

업체가 내놓은 한국어 WER 수치는 서로 맞지 않으므로, 우리 영상으로 직접 잰다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ..korean import normalize
from ..transcript import Word
from .base import TranscriptResult, Transcriber


def tokenize(text: str) -> list[str]:
    return [t for t in (normalize(x) for x in text.split()) if t]


def edit_distance(a: list[str], b: list[str]) -> int:
    """Levenshtein 거리. WER 계산용."""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref, hyp = tokenize(reference), tokenize(hypothesis)
    if not ref:
        return 0.0
    return edit_distance(ref, hyp) / len(ref)


def char_error_rate(reference: str, hypothesis: str) -> float:
    ref = list("".join(tokenize(reference)))
    hyp = list("".join(tokenize(hypothesis)))
    if not ref:
        return 0.0
    return edit_distance(ref, hyp) / len(ref)


def boundary_error_ms(reference: list[Word], hypothesis: list[Word]) -> float | None:
    """같은 어절끼리 짝지어 시작 시각 차이의 평균을 낸다.

    자막 싱크가 이 값에 달려 있다. 100ms를 넘으면 눈에 띈다.
    """
    if not reference or not hypothesis:
        return None
    by_text: dict[str, list[Word]] = {}
    for w in hypothesis:
        by_text.setdefault(normalize(w.text), []).append(w)

    diffs: list[int] = []
    for ref in reference:
        key = normalize(ref.text)
        bucket = by_text.get(key)
        if not bucket:
            continue
        # 시간이 가장 가까운 것을 같은 단어로 본다
        match = min(bucket, key=lambda w: abs(w.start_ms - ref.start_ms))
        if abs(match.start_ms - ref.start_ms) > 5_000:
            continue  # 전혀 다른 자리면 짝이 아니다
        diffs.append(abs(match.start_ms - ref.start_ms))
    return sum(diffs) / len(diffs) if diffs else None


@dataclass
class EngineReport:
    engine: str
    words: int
    audio_seconds: float
    wall_seconds: float
    usd: float
    wer: float | None = None
    cer: float | None = None
    boundary_mae_ms: float | None = None
    error: str | None = None

    @property
    def speed_ratio(self) -> float:
        return self.wall_seconds / self.audio_seconds if self.audio_seconds else 0.0

    def line(self) -> str:
        if self.error:
            return f"  {self.engine:<12} 실패: {self.error}"
        wer = f"{self.wer:.3f}" if self.wer is not None else "  –  "
        cer = f"{self.cer:.3f}" if self.cer is not None else "  –  "
        bnd = f"{self.boundary_mae_ms:.0f}ms" if self.boundary_mae_ms is not None else "  –  "
        return (
            f"  {self.engine:<12} WER {wer}  CER {cer}  경계오차 {bnd:>7}  "
            f"{self.words:>5}어절  {self.speed_ratio:.2f}x  ${self.usd:.4f}"
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "engine": self.engine,
            "words": self.words,
            "audioSeconds": round(self.audio_seconds, 2),
            "wallSeconds": round(self.wall_seconds, 2),
            "speedRatio": round(self.speed_ratio, 3),
            "usd": round(self.usd, 6),
            "wer": round(self.wer, 4) if self.wer is not None else None,
            "cer": round(self.cer, 4) if self.cer is not None else None,
            "boundaryMaeMs": round(self.boundary_mae_ms, 1) if self.boundary_mae_ms is not None else None,
            "error": self.error,
        }


def evaluate_engine(
    engine: Transcriber,
    audio_path: Path,
    reference_text: str | None,
    reference_words: list[Word] | None,
    language: str = "ko",
) -> tuple[EngineReport, TranscriptResult | None]:
    try:
        result = engine.transcribe(audio_path, language=language)
    except Exception as exc:  # 한 엔진이 실패해도 나머지는 계속 잰다
        return EngineReport(engine=engine.name, words=0, audio_seconds=0, wall_seconds=0, usd=0,
                            error=f"{type(exc).__name__}: {exc}"), None

    report = EngineReport(
        engine=result.engine,
        words=len(result.words),
        audio_seconds=result.audio_seconds,
        wall_seconds=result.wall_seconds,
        usd=result.usd,
        wer=word_error_rate(reference_text, result.text) if reference_text else None,
        cer=char_error_rate(reference_text, result.text) if reference_text else None,
        boundary_mae_ms=boundary_error_ms(reference_words, result.words) if reference_words else None,
    )
    return report, result


def write_comparison(path: Path, audio: Path, reports: list[EngineReport]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"audio": audio.name, "engines": [r.to_dict() for r in reports]}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
