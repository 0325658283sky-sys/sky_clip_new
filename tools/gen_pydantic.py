"""JSON Schema -> Pydantic v2 모델 생성.

Zod가 단일 원천이므로 이 파일을 손으로 고치지 않는다.
    npm run schema:json && npm run schema:python
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "packages" / "schema" / "generated"

TARGETS = [
    ("project.schema.json", "project_models.py", "Project"),
    ("template-spec.schema.json", "template_models.py", "TemplateSpec"),
    ("resolved-timeline.schema.json", "resolved_models.py", "ResolvedTimeline"),
]


def main() -> int:
    missing = [name for name, _, _ in TARGETS if not (GEN / name).exists()]
    if missing:
        print(f"JSON Schema가 없습니다: {', '.join(missing)}\n먼저 `npm run schema:json`을 실행하세요.")
        return 1

    for src, dst, class_name in TARGETS:
        cmd = [
            sys.executable, "-m", "datamodel_code_generator",
            "--input", str(GEN / src),
            "--input-file-type", "jsonschema",
            "--output", str(GEN / dst),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--target-python-version", "3.12",
            "--class-name", class_name,
            "--use-standard-collections",
            "--use-union-operator",
            "--use-schema-description",
            "--disable-timestamp",
        ]
        print(" ".join(cmd))
        result = subprocess.run(cmd)
        if result.returncode != 0:
            return result.returncode
    print("생성 완료:", GEN)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
