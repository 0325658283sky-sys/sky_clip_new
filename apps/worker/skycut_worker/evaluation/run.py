"""평가셋을 돌려 지표를 내고 기준선과 비교한다.

프롬프트·모델·STT를 바꿀 때마다 이걸 돌린다. 기준선보다 떨어지면 반영하지 않는다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config import RunConfig
from ..cost import CostReport
from ..highlight import StubLlm, extract_highlights
from ..highlight.llm import AnthropicLlm, LlmClient
from ..project_io import load_project, request_from_project, view_from_project
from ..transcript import TranscriptView
from .dataset import EvalSet, load_dataset, load_ratings
from .metrics import Aggregate, Comparison, ItemResult, Range, aggregate, compare


@dataclass
class EvalRun:
    aggregate: Aggregate
    items: list[ItemResult]
    total_usd: float
    comparisons: list[Comparison]

    @property
    def regressed(self) -> bool:
        return any(c.regressed for c in self.comparisons)

    def summary(self) -> str:
        lines = [self.aggregate.summary(), f"  영상당 평균 비용 ${self.total_usd / max(1, self.aggregate.items):.4f}"]
        if self.comparisons:
            lines.append("\n기준선 대비:")
            lines += [c.line() for c in self.comparisons]
            lines.append("  → 기준선보다 떨어졌습니다. 반영하지 마세요." if self.regressed else "  → 기준선 유지")
        return "\n".join(lines)


def _llm_for(view: TranscriptView, cfg: RunConfig, report: CostReport) -> LlmClient:
    return StubLlm(view) if cfg.offline else AnthropicLlm(cfg, report)


def run_eval(root: Path, cfg: RunConfig, limit: int | None = None) -> EvalRun:
    dataset: EvalSet = load_dataset(root)
    ratings = load_ratings(root)
    items = dataset.items[:limit] if limit else dataset.items

    results: list[ItemResult] = []
    total_usd = 0.0

    for item in items:
        project = load_project(item.project_path)
        view = view_from_project(project)

        item_cfg = RunConfig(
            request=request_from_project(project, cfg.request),
            window=cfg.window,
            offline=cfg.offline,
            model=cfg.model,
            effort=cfg.effort,
        )
        if item.genre and not item_cfg.request.genre:
            item_cfg.request = type(item_cfg.request)(
                prompt=item_cfg.request.prompt,
                min_duration_ms=item_cfg.request.min_duration_ms,
                max_duration_ms=item_cfg.request.max_duration_ms,
                genre=item.genre,
                max_clips=item_cfg.request.max_clips,
            )

        report = CostReport(project_id=item.project_id)
        outcome = extract_highlights(view, _llm_for(view, item_cfg, report), item_cfg)
        total_usd += report.total_usd

        predicted = [
            Range(view.words[c.start_idx].start_ms, view.words[c.end_idx].end_ms)
            for c in outcome.clips
        ]
        item_ratings = ratings.get(item.project_id, {})
        results.append(
            ItemResult(
                project_id=item.project_id,
                predicted=predicted,
                labels=item.merged_labels(),
                ratings={
                    cid: float(v["rating"])
                    for cid, v in item_ratings.items()
                    if isinstance(v, dict) and isinstance(v.get("rating"), (int, float))
                },
                shareable={
                    cid: bool(v["shareable"])
                    for cid, v in item_ratings.items()
                    if isinstance(v, dict) and "shareable" in v
                },
            )
        )

    agg = aggregate(results)
    baseline = load_baseline(root)
    comparisons = compare(baseline, agg) if baseline else []
    return EvalRun(aggregate=agg, items=results, total_usd=total_usd, comparisons=comparisons)


def load_baseline(root: Path) -> dict[str, Any] | None:
    path = root / "baseline.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw.get("aggregate", raw)


def write_result(root: Path, run: EvalRun, cfg: RunConfig, prompt_version: str) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = root / "results" / f"{stamp}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ranAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "model": "offline-stub" if cfg.offline else cfg.model,
        "effort": cfg.effort,
        "promptVersion": prompt_version,
        "aggregate": run.aggregate.to_dict(),
        "totalUsd": round(run.total_usd, 6),
        "items": [
            {
                "projectId": r.project_id,
                "predicted": [{"startMs": p.start_ms, "endMs": p.end_ms} for p in r.predicted],
                "labelCount": len(r.labels),
                "hitRateAt5": round(r.hit_rate_at(5), 4),
                "coverage": round(r.coverage(), 4),
            }
            for r in run.items
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def promote_baseline(root: Path, result_path: Path) -> Path:
    """이번 결과를 새 기준선으로 삼는다. 사람이 결과를 보고 결정한다."""
    raw = json.loads(result_path.read_text(encoding="utf-8"))
    path = root / "baseline.json"
    path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
