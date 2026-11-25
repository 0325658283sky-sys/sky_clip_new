"""평가셋.

사람이 "쇼츠로 쓸 만한 구간"을 표시해 둔 정답 데이터와, 만들어진 클립에
사람이 매긴 평점을 읽는다.

    eval/
      dataset.json          평가셋 목록과 정답 라벨
      projects/<id>.json    대본이 들어 있는 Project JSON
      ratings.json          사람이 매긴 평점 (선택)
      baseline.json         기준선 지표
      results/<시각>.json   실행 결과
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from ..config import ROOT
from .metrics import Range


def resolve_project_path(raw: str, root: Path) -> Path:
    """dataset.json의 경로를 실제 파일로 푼다.

    경로는 **저장소 루트 기준**으로 적는다. 평가셋을 커밋해 다른 컴퓨터에서
    돌려도 같은 파일을 가리키게 하기 위해서다. 평가셋 폴더 안에 둔 파일도
    받아 준다.
    """
    path = Path(raw)
    if path.is_absolute():
        return path
    from_repo = ROOT / path
    if from_repo.exists():
        return from_repo
    return root / path


@dataclass
class LabelSet:
    labeler: str
    ranges: list[Range]


@dataclass
class EvalItem:
    project_id: str
    project_path: Path
    genre: str | None = None
    note: str = ""
    labels: list[LabelSet] = field(default_factory=list)

    def merged_labels(self) -> list[Range]:
        """라벨러가 여럿이면 겹치는 구간을 합친다.

        두 사람이 비슷한 자리를 짚었으면 같은 정답으로 본다.
        """
        every = sorted(
            (r for ls in self.labels for r in ls.ranges),
            key=lambda r: (r.start_ms, r.end_ms),
        )
        merged: list[Range] = []
        for r in every:
            if merged and r.start_ms <= merged[-1].end_ms:
                prev = merged[-1]
                merged[-1] = Range(prev.start_ms, max(prev.end_ms, r.end_ms))
                continue
            merged.append(r)
        return merged


@dataclass
class EvalSet:
    root: Path
    items: list[EvalItem]

    @property
    def labeled_count(self) -> int:
        """정답 구간이 실제로 하나라도 채워진 영상 수.

        `eval-init`이 만드는 틀에는 비어 있는 labels 자리가 들어 있으므로,
        그걸 라벨링된 것으로 세면 안 된다.
        """
        return sum(1 for i in self.items if any(ls.ranges for ls in i.labels))


def load_dataset(root: Path) -> EvalSet:
    path = root / "dataset.json"
    if not path.exists():
        raise FileNotFoundError(
            f"평가셋이 없습니다: {path}\n"
            "`skycut-worker eval-init` 으로 틀을 만든 뒤 라벨을 채우세요."
        )
    raw = json.loads(path.read_text(encoding="utf-8"))

    items: list[EvalItem] = []
    for entry in raw.get("items", []):
        items.append(
            EvalItem(
                project_id=entry["projectId"],
                project_path=resolve_project_path(entry["projectPath"], root),
                genre=entry.get("genre"),
                note=entry.get("note", ""),
                labels=[
                    LabelSet(
                        labeler=ls.get("labeler", "?"),
                        ranges=[Range(r["startMs"], r["endMs"]) for r in ls.get("ranges", [])],
                    )
                    for ls in entry.get("labels", [])
                ],
            )
        )
    return EvalSet(root=root, items=items)


def load_ratings(root: Path) -> dict[str, dict[str, dict[str, object]]]:
    """사람이 매긴 평점. 없으면 빈 dict.

    형식: {"<projectId>": {"<clipId>": {"rating": 4, "shareable": true, "note": "..."}}}
    """
    path = root / "ratings.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_template(root: Path, project_paths: list[Path]) -> Path:
    """라벨을 채워 넣을 평가셋 틀을 만든다."""
    root.mkdir(parents=True, exist_ok=True)
    items = []
    for p in project_paths:
        raw = json.loads(p.read_text(encoding="utf-8"))
        # 저장소 루트 기준 경로로 적어 둔다 (resolve_project_path 참고)
        try:
            rel = p.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            rel = p.resolve().as_posix()
        items.append(
            {
                "projectId": raw["id"],
                "projectPath": rel,
                "genre": None,
                "note": "장르를 적고, 아래 labels에 '쇼츠로 쓸 만한 구간'을 ms 단위로 채우세요",
                "labels": [{"labeler": "사람1", "ranges": []}],
            }
        )
    path = root / "dataset.json"
    path.write_text(
        json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path
