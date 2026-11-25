"""설정과 경로.

API 키는 .env 파일에서만 읽는다. 코드나 로그에 키를 쓰지 않는다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
SCHEMA_GENERATED = ROOT / "packages" / "schema" / "generated"
FIXTURES = ROOT / "fixtures"
EVAL_DIR = ROOT / "eval"
WORK_DIR = ROOT / "out" / "worker"

load_dotenv(ROOT / ".env")

# 하이라이트 추출에 쓰는 모델. 맥락 이해가 서비스 품질을 좌우하므로 가장 좋은 모델을 쓴다.
LLM_MODEL = os.getenv("SKYCUT_LLM_MODEL", "claude-opus-5-5")
LLM_EFFORT = os.getenv("SKYCUT_LLM_EFFORT", "high")

# 프롬프트를 바꾸면 반드시 올린다. 결과에 기록되어 회귀 평가의 기준이 된다.
PROMPT_VERSION = "m1-2026-11-25"


@dataclass(frozen=True)
class ExtractionRequest:
    """사용자가 고른 추출 조건."""

    prompt: str | None = None
    """'~에 대한 부분만 뽑아줘' 같은 주제 지정"""
    min_duration_ms: int = 20_000
    max_duration_ms: int = 60_000
    genre: str | None = None
    """예능 / 정보 / 인터뷰 / 팟캐스트 — 프롬프트 프리셋을 고른다"""
    max_clips: int = 5

    def describe(self) -> str:
        parts = [f"길이 {self.min_duration_ms // 1000}~{self.max_duration_ms // 1000}초"]
        if self.genre:
            parts.append(f"장르 {self.genre}")
        if self.prompt:
            parts.append(f"주제 지정 '{self.prompt}'")
        return ", ".join(parts)


@dataclass(frozen=True)
class WindowConfig:
    """긴 영상을 나눠 처리할 때의 창 크기 (어절 수)."""

    size: int = 2000
    overlap: int = 120


@dataclass
class RunConfig:
    request: ExtractionRequest = field(default_factory=ExtractionRequest)
    window: WindowConfig = field(default_factory=WindowConfig)
    offline: bool = False
    """True면 LLM을 호출하지 않고 결정적 스텁을 쓴다 (테스트·개발용)"""
    model: str = LLM_MODEL
    effort: str = LLM_EFFORT


def anthropic_api_key() -> str | None:
    return os.getenv("ANTHROPIC_API_KEY")


def require_anthropic_key() -> str:
    key = anthropic_api_key()
    if not key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY가 없습니다.\n"
            f"  {ROOT / '.env'} 에 ANTHROPIC_API_KEY=... 를 넣거나,\n"
            "  --offline 으로 스텁 모드로 실행하세요."
        )
    return key
