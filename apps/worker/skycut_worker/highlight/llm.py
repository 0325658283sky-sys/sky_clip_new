"""LLM 호출 한 겹.

- 구조화 출력으로 형식을 강제한다 (`output_format`)
- 바뀌지 않는 지시문은 캐시해 반복 호출 비용을 줄인다
- 거절(refusal)을 조용히 넘기지 않는다
- 토큰 사용량을 CostReport에 남긴다 (M1 Gate: 영상당 비용 기록)
"""
from __future__ import annotations

import time
from typing import Protocol, TypeVar

from pydantic import BaseModel

from ..config import RunConfig, require_anthropic_key
from ..cost import CostReport, LlmCall

T = TypeVar("T", bound=BaseModel)

MAX_TOKENS = 16_000
#: 정책상 거절됐을 때 서버가 알아서 다른 모델로 넘긴다
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LlmClient(Protocol):
    def structured(self, step: str, system: str, user: str, output_format: type[T]) -> T: ...


class AnthropicLlm:
    def __init__(self, cfg: RunConfig, report: CostReport) -> None:
        import anthropic  # 선택 의존성이 아니지만 오프라인 경로에서는 불러오지 않는다

        self._client = anthropic.Anthropic(api_key=require_anthropic_key())
        self._cfg = cfg
        self._report = report

    def structured(self, step: str, system: str, user: str, output_format: type[T]) -> T:
        started = time.monotonic()
        response = self._client.beta.messages.parse(
            model=self._cfg.model,
            max_tokens=MAX_TOKENS,
            # 단계별 지시문은 영상이 달라도 같으므로 캐시된다
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_format=output_format,
            output_config={"effort": self._cfg.effort},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        elapsed = time.monotonic() - started

        usage = response.usage
        self._report.add(
            LlmCall(
                step=step,
                model=self._cfg.model,
                input_tokens=getattr(usage, "input_tokens", 0) or 0,
                output_tokens=getattr(usage, "output_tokens", 0) or 0,
                cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
                cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
                seconds=elapsed,
            )
        )

        if response.stop_reason == "refusal":
            detail = getattr(response, "stop_details", None)
            category = getattr(detail, "category", None)
            raise LlmRefused(step, category)

        if response.parsed_output is None:
            raise LlmFailed(f"{step}: 구조화 출력을 받지 못했습니다 (stop_reason={response.stop_reason})")

        return response.parsed_output


class LlmRefused(RuntimeError):
    def __init__(self, step: str, category: str | None) -> None:
        super().__init__(
            f"{step} 단계에서 모델이 요청을 거절했습니다"
            + (f" (분류: {category})" if category else "")
            + ".\n원본 영상의 내용이 정책에 걸렸을 수 있습니다. 해당 구간을 빼고 다시 시도하세요."
        )
        self.step = step
        self.category = category


class LlmFailed(RuntimeError):
    pass
