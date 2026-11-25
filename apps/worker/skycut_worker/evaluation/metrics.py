"""하이라이트 품질 지표.

"볼 만한 구간을 고르는가"가 서비스 경쟁력의 핵심이므로, 프롬프트나 모델을
바꿀 때마다 같은 자로 재서 떨어졌는지 확인한다.

지표는 전부 **시간(ms) 기준**이다. 단어 인덱스는 STT 엔진이 바뀌면 달라지므로
엔진 간 비교가 되지 않는다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

#: 정답 구간과 이만큼 겹치면 "찾았다"고 본다
HIT_IOU = 0.5


@dataclass(frozen=True)
class Range:
    start_ms: int
    end_ms: int

    @property
    def length(self) -> int:
        return max(0, self.end_ms - self.start_ms)


def iou(a: Range, b: Range) -> float:
    inter = max(0, min(a.end_ms, b.end_ms) - max(a.start_ms, b.start_ms))
    union = a.length + b.length - inter
    return inter / union if union > 0 else 0.0


def best_match(pred: Range, labels: list[Range]) -> tuple[float, int | None]:
    """가장 많이 겹치는 정답 구간과 그 IoU."""
    best, at = 0.0, None
    for i, label in enumerate(labels):
        score = iou(pred, label)
        if score > best:
            best, at = score, i
    return best, at


@dataclass
class ItemResult:
    project_id: str
    predicted: list[Range]
    labels: list[Range]
    threshold: float = HIT_IOU

    #: 사람이 매긴 값 (없으면 비어 있다)
    ratings: dict[str, float] = field(default_factory=dict)
    shareable: dict[str, bool] = field(default_factory=dict)

    def hits(self, k: int) -> list[bool]:
        """상위 k개가 각각 정답과 겹치는지."""
        used: set[int] = set()
        out: list[bool] = []
        for pred in self.predicted[:k]:
            score, at = best_match(pred, self.labels)
            ok = score >= self.threshold and at is not None and at not in used
            if ok and at is not None:
                used.add(at)
            out.append(ok)
        return out

    def hit_rate_at(self, k: int) -> float:
        got = self.hits(k)
        return sum(got) / len(got) if got else 0.0

    def coverage(self) -> float:
        """정답 구간 중 몇 개를 찾아냈는가."""
        if not self.labels:
            return 0.0
        found = 0
        for label in self.labels:
            if any(iou(p, label) >= self.threshold for p in self.predicted):
                found += 1
        return found / len(self.labels)

    @property
    def mean_rating(self) -> float | None:
        return sum(self.ratings.values()) / len(self.ratings) if self.ratings else None

    @property
    def shareable_rate(self) -> float | None:
        if not self.shareable:
            return None
        return sum(1 for v in self.shareable.values() if v) / len(self.shareable)


@dataclass
class Aggregate:
    items: int
    clips: int
    hit_rate_at_5: float
    coverage: float
    mean_rating: float | None
    shareable_rate: float | None
    items_with_3_plus: float
    """후보를 3개 이상 낸 영상의 비율 (M1 Gate)"""

    def summary(self) -> str:
        lines = [
            f"영상 {self.items}개 · 클립 {self.clips}개",
            f"  적중률@5     {self.hit_rate_at_5:.3f}",
            f"  정답 발견율  {self.coverage:.3f}",
            f"  3개 이상 생성 {self.items_with_3_plus:.3f}",
        ]
        lines.append(
            f"  평균 평점    {self.mean_rating:.2f}" if self.mean_rating is not None
            else "  평균 평점    (사람 평가 없음)"
        )
        lines.append(
            f"  바로 공유 가능 {self.shareable_rate:.3f}" if self.shareable_rate is not None
            else "  바로 공유 가능 (사람 평가 없음)"
        )
        return "\n".join(lines)

    def to_dict(self) -> dict[str, object]:
        return {
            "items": self.items,
            "clips": self.clips,
            "hitRateAt5": round(self.hit_rate_at_5, 4),
            "coverage": round(self.coverage, 4),
            "meanRating": round(self.mean_rating, 3) if self.mean_rating is not None else None,
            "shareableRate": round(self.shareable_rate, 4) if self.shareable_rate is not None else None,
            "itemsWith3Plus": round(self.items_with_3_plus, 4),
        }


def aggregate(results: list[ItemResult], k: int = 5, min_clips: int = 3) -> Aggregate:
    if not results:
        return Aggregate(0, 0, 0.0, 0.0, None, None, 0.0)

    labeled = [r for r in results if r.labels]
    ratings = [v for r in results for v in r.ratings.values()]
    shareable = [v for r in results for v in r.shareable.values()]

    return Aggregate(
        items=len(results),
        clips=sum(len(r.predicted) for r in results),
        hit_rate_at_5=sum(r.hit_rate_at(k) for r in labeled) / len(labeled) if labeled else 0.0,
        coverage=sum(r.coverage() for r in labeled) / len(labeled) if labeled else 0.0,
        mean_rating=sum(ratings) / len(ratings) if ratings else None,
        shareable_rate=sum(1 for v in shareable if v) / len(shareable) if shareable else None,
        items_with_3_plus=sum(1 for r in results if len(r.predicted) >= min_clips) / len(results),
    )


@dataclass
class Comparison:
    metric: str
    baseline: float
    current: float
    tolerance: float

    @property
    def delta(self) -> float:
        return self.current - self.baseline

    @property
    def regressed(self) -> bool:
        return self.delta < -self.tolerance

    def line(self) -> str:
        mark = "↓ 하락" if self.regressed else ("↑" if self.delta > 0 else "–")
        return f"  {self.metric:<14} {self.baseline:.3f} → {self.current:.3f}  ({self.delta:+.3f}) {mark}"


def compare(baseline: dict[str, object], current: Aggregate, tolerance: float = 0.02) -> list[Comparison]:
    """기준선보다 떨어졌는지 본다. 떨어지면 배포하지 않는다."""
    out: list[Comparison] = []
    now = current.to_dict()
    for key, label in (("hitRateAt5", "적중률@5"), ("coverage", "정답 발견율"),
                       ("meanRating", "평균 평점"), ("shareableRate", "바로 공유 가능")):
        base_v, cur_v = baseline.get(key), now.get(key)
        if isinstance(base_v, (int, float)) and isinstance(cur_v, (int, float)):
            # 평점은 5점 만점이라 허용 오차를 비율에 맞춘다
            tol = tolerance * 5 if key == "meanRating" else tolerance
            out.append(Comparison(label, float(base_v), float(cur_v), tol))
    return out
