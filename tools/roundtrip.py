"""TS → JSON → Python → JSON 왕복 검증의 Python 쪽.

생성된 Pydantic 모델로 fixtures를 읽고 다시 써서 .roundtrip/ 에 남긴다.
TS 쪽(tools/roundtrip-check.ts)이 원본과 비교한다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "packages" / "schema" / "generated"
FIXTURES = ROOT / "fixtures"
OUT = ROOT / ".roundtrip"

sys.path.insert(0, str(GEN))

from project_models import Project  # noqa: E402
from template_models import TemplateSpec  # noqa: E402
from resolved_models import ResolvedTimeline  # noqa: E402


def roundtrip(path: Path, model, out_dir: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    parsed = model.model_validate(raw)
    # exclude_none=False 로 두면 Optional 필드가 null로 늘어난다 → 원본과 비교 가능하게 제거
    dumped = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / path.name).write_text(
        json.dumps(dumped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  OK  {path.name}")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    print("Project (fixtures):")
    files = sorted(FIXTURES.glob("*.json"))
    if not files:
        print("fixtures가 없습니다. 먼저 `npm run fixtures`를 실행하세요.")
        return 1
    for f in files:
        roundtrip(f, Project, OUT / "fixtures")

    print("TemplateSpec:")
    tpl_dir = ROOT / ".roundtrip" / "templates-in"
    if tpl_dir.exists():
        for f in sorted(tpl_dir.glob("*.json")):
            roundtrip(f, TemplateSpec, OUT / "templates")

    print("ResolvedTimeline:")
    tl_dir = ROOT / ".roundtrip" / "timelines-in"
    if tl_dir.exists():
        for f in sorted(tl_dir.glob("*.json")):
            roundtrip(f, ResolvedTimeline, OUT / "timelines")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
