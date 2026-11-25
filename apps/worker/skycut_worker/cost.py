"""영상 1개당 외부 API 비용을 기록한다 (M1 Gate 항목).

가격은 바뀌므로 PRICING은 기준값일 뿐이다. 실제 청구서로 주기적으로 맞춘다.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

# USD / 100만 토큰. 2026-11 기준 Anthropic 공개가.
PRICING: dict[str, dict[str, float]] = {
    "claude-opus-5-5": {"input": 4.0, "output": 20.0, "cache_read": 0.20, "cache_write": 5.0},
    "claude-sonnet-5-5": {"input": 2.0, "output": 10.0, "cache_read": 0.10, "cache_write": 2.5},
    "claude-haiku-5-5": {"input": 0.10, "output": 0.50, "cache_read": 0.01, "cache_write": 0.125},
}


@dataclass
class LlmCall:
    step: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    seconds: float = 0.0

    @property
    def usd(self) -> float:
        p = PRICING.get(self.model)
        if not p:
            return 0.0
        return (
            self.input_tokens * p["input"]
            + self.output_tokens * p["output"]
            + self.cache_read_tokens * p["cache_read"]
            + self.cache_write_tokens * p["cache_write"]
        ) / 1_000_000


@dataclass
class SttUsage:
    engine: str
    audio_seconds: float = 0.0
    usd: float = 0.0


@dataclass
class TtsUsage:
    provider: str
    characters: int = 0
    usd: float = 0.0


@dataclass
class CostReport:
    project_id: str
    llm_calls: list[LlmCall] = field(default_factory=list)
    stt: SttUsage | None = None
    tts: TtsUsage | None = None

    def add(self, call: LlmCall) -> None:
        self.llm_calls.append(call)

    @property
    def llm_usd(self) -> float:
        return sum(c.usd for c in self.llm_calls)

    @property
    def total_usd(self) -> float:
        return self.llm_usd + (self.stt.usd if self.stt else 0.0) + (self.tts.usd if self.tts else 0.0)

    def summary(self) -> str:
        lines = [f"비용 — {self.project_id}"]
        by_step: dict[str, LlmCall] = {}
        for c in self.llm_calls:
            agg = by_step.setdefault(c.step, LlmCall(step=c.step, model=c.model))
            agg.input_tokens += c.input_tokens
            agg.output_tokens += c.output_tokens
            agg.cache_read_tokens += c.cache_read_tokens
            agg.cache_write_tokens += c.cache_write_tokens
            agg.seconds += c.seconds
        for step, c in by_step.items():
            lines.append(
                f"  {step:<14} in {c.input_tokens:>7,}  out {c.output_tokens:>6,}  "
                f"cache {c.cache_read_tokens:>7,}  {c.seconds:>5.1f}s  ${c.usd:.4f}"
            )
        if self.stt:
            lines.append(f"  {'STT':<14} {self.stt.engine} {self.stt.audio_seconds:.0f}s  ${self.stt.usd:.4f}")
        if self.tts:
            lines.append(f"  {'TTS':<14} {self.tts.provider} {self.tts.characters:,}자  ${self.tts.usd:.4f}")
        lines.append(f"  {'합계':<14} ${self.total_usd:.4f}")
        return "\n".join(lines)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "projectId": self.project_id,
            "llmCalls": [asdict(c) | {"usd": round(c.usd, 6)} for c in self.llm_calls],
            "stt": asdict(self.stt) if self.stt else None,
            "tts": asdict(self.tts) if self.tts else None,
            "totalUsd": round(self.total_usd, 6),
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
