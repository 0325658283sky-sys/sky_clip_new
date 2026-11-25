"""품질 지표와 회귀 판정."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from skycut_worker.evaluation import ItemResult, Range, aggregate, compare, iou
from skycut_worker.evaluation.dataset import EvalItem, LabelSet, load_dataset, write_template
from skycut_worker.stt.compare import boundary_error_ms, char_error_rate, word_error_rate
from skycut_worker.transcript import Word


# ── IoU / 적중률 ──────────────────────────────────────────


def test_완전히_같으면_iou가_1() -> None:
    a = Range(1000, 5000)
    assert iou(a, a) == pytest.approx(1.0)


def test_떨어져_있으면_iou가_0() -> None:
    assert iou(Range(0, 1000), Range(2000, 3000)) == 0.0


def test_정답과_겹치면_적중() -> None:
    item = ItemResult(
        project_id="p",
        predicted=[Range(0, 10_000)],
        labels=[Range(1_000, 10_500)],
    )
    assert item.hit_rate_at(5) == pytest.approx(1.0)


def test_같은_정답을_두_번_맞췄다고_치지_않는다() -> None:
    """두 예측이 같은 정답에 겹쳐도 적중은 한 번이다."""
    item = ItemResult(
        project_id="p",
        predicted=[Range(0, 10_000), Range(100, 10_100)],
        labels=[Range(0, 10_000)],
    )
    assert item.hits(5) == [True, False]


def test_정답_발견율() -> None:
    item = ItemResult(
        project_id="p",
        predicted=[Range(0, 10_000)],
        labels=[Range(0, 10_000), Range(50_000, 60_000)],
    )
    assert item.coverage() == pytest.approx(0.5)


def test_라벨이_없으면_적중률_계산에서_빠진다() -> None:
    agg = aggregate([ItemResult("a", [Range(0, 1000)], []), ItemResult("b", [Range(0, 1000)], [Range(0, 1000)])])
    assert agg.items == 2
    assert agg.hit_rate_at_5 == pytest.approx(1.0)  # 라벨 있는 b만 셈


def test_3개_이상_생성_비율() -> None:
    agg = aggregate([
        ItemResult("a", [Range(i * 1000, i * 1000 + 500) for i in range(3)], []),
        ItemResult("b", [Range(0, 500)], []),
    ])
    assert agg.items_with_3_plus == pytest.approx(0.5)


# ── 회귀 판정 ─────────────────────────────────────────────


def test_기준선보다_떨어지면_잡아낸다() -> None:
    current = aggregate([ItemResult("a", [Range(0, 1000)], [Range(90_000, 95_000)])])
    diffs = compare({"hitRateAt5": 0.8, "coverage": 0.8}, current)
    assert any(c.regressed for c in diffs)


def test_오차_범위_안이면_하락으로_보지_않는다() -> None:
    current = aggregate([ItemResult("a", [Range(0, 10_000)], [Range(0, 10_000)])])
    diffs = compare({"hitRateAt5": 1.01}, current, tolerance=0.05)
    assert not any(c.regressed for c in diffs)


# ── 평가셋 ────────────────────────────────────────────────


def test_라벨러가_여럿이면_겹치는_정답을_합친다() -> None:
    item = EvalItem(
        project_id="p",
        project_path=Path("x.json"),
        labels=[
            LabelSet("사람1", [Range(0, 10_000), Range(30_000, 40_000)]),
            LabelSet("사람2", [Range(5_000, 12_000)]),
        ],
    )
    merged = item.merged_labels()
    assert len(merged) == 2
    assert merged[0] == Range(0, 12_000)


def test_평가셋_틀을_만들고_읽는다(tmp_path: Path) -> None:
    project = tmp_path / "p.json"
    project.write_text(json.dumps({"id": "ev-1"}), encoding="utf-8")
    write_template(tmp_path, [project])
    loaded = load_dataset(tmp_path)
    assert [i.project_id for i in loaded.items] == ["ev-1"]
    assert loaded.labeled_count == 0  # 라벨은 사람이 채운다


def test_평가셋이_없으면_무엇을_하라고_알려준다(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="eval-init"):
        load_dataset(tmp_path)


# ── STT 비교 지표 ─────────────────────────────────────────


def test_같은_문장이면_오인식률_0() -> None:
    assert word_error_rate("물은 종이컵 세 컵", "물은 종이컵 세 컵") == 0.0


def test_한_어절_틀리면_사분의일() -> None:
    assert word_error_rate("물은 종이컵 세 컵", "물은 종이컵 네 컵") == pytest.approx(0.25)


def test_구두점은_무시한다() -> None:
    assert word_error_rate("정답은 종이컵입니다.", "정답은 종이컵입니다") == 0.0


def test_글자_단위_오류율도_센다() -> None:
    assert char_error_rate("종이컵", "종이컵") == 0.0
    assert char_error_rate("종이컵", "종이잔") > 0


def test_단어_시간_오차를_잰다() -> None:
    ref = [Word(id="r0", text="종이컵", start_ms=1000, end_ms=1500)]
    hyp = [Word(id="h0", text="종이컵", start_ms=1080, end_ms=1600)]
    assert boundary_error_ms(ref, hyp) == pytest.approx(80.0)


def test_짝이_없으면_시간_오차는_None() -> None:
    ref = [Word(id="r0", text="종이컵", start_ms=1000, end_ms=1500)]
    hyp = [Word(id="h0", text="주전자", start_ms=1000, end_ms=1500)]
    assert boundary_error_ms(ref, hyp) is None
