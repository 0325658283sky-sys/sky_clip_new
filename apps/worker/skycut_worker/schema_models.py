"""생성된 Pydantic 스키마를 불러온다.

Zod가 단일 원천이고(packages/schema/src), 여기서 쓰는 모델은 생성물이다.
스키마를 고치려면 Zod를 고치고 `npm run schema:json && npm run schema:python`.
"""
from __future__ import annotations

import sys

from .config import SCHEMA_GENERATED

if str(SCHEMA_GENERATED) not in sys.path:
    sys.path.insert(0, str(SCHEMA_GENERATED))

try:
    from project_models import Project  # type: ignore[import-not-found]
except ModuleNotFoundError as exc:  # pragma: no cover - 설치 안내
    raise ModuleNotFoundError(
        f"생성된 Pydantic 모델을 찾을 수 없습니다 ({SCHEMA_GENERATED}).\n"
        "저장소 루트에서 다음을 실행하세요:\n"
        "  npm run schema:json && npm run schema:python"
    ) from exc

__all__ = ["Project"]
