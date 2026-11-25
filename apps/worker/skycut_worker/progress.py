"""진행률 보고.

사람이 읽는 줄과 기계가 읽는 JSON 줄을 가른다. API 서버는 워커를
subprocess로 띄우고 stdout의 JSON 줄을 읽어 SSE로 흘려보낸다.

    {"event":"progress","stage":"ingest","label":"영상 받는 중","pct":0.12}
    {"event":"done","project":"out/p.json","clips":3}
    {"event":"error","reason":"geo_blocked","message":"이 지역에서는 ..."}

단계마다 가중치를 둔다. 받아쓰기가 전체의 4분의 1인데 진행 바가
단계 수로만 움직이면 사용자가 멈춘 줄 안다.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Stage:
    id: str
    label: str
    weight: float


#: 영상 입력의 단계와 가중치 (합이 1)
VIDEO_STAGES: tuple[Stage, ...] = (
    Stage("ingest", "영상 받는 중", 0.35),
    Stage("transcribe", "말 받아쓰는 중", 0.25),
    Stage("highlight", "볼 만한 구간 찾는 중", 0.33),
    Stage("compose", "쇼츠 구성하는 중", 0.07),
)

#: 블로그 입력의 단계와 가중치
BLOG_STAGES: tuple[Stage, ...] = (
    Stage("fetch", "글 가져오는 중", 0.10),
    Stage("script", "대본 쓰는 중", 0.30),
    Stage("images", "이미지 가져오는 중", 0.15),
    Stage("tts", "나레이션 만드는 중", 0.38),
    Stage("compose", "쇼츠 구성하는 중", 0.07),
)


class ProgressReporter:
    """단계를 알고 있으면서 퍼센트를 계산해 준다."""

    def __init__(self, stages: tuple[Stage, ...], json_mode: bool = False) -> None:
        self._stages = stages
        self._json = json_mode
        self._index = -1
        self._done_weight = 0.0

    # ── 쓰기 ──────────────────────────────────────────────

    def stage(self, stage_id: str) -> None:
        """다음 단계로 넘어간다. 모르는 id면 무시한다."""
        for i, s in enumerate(self._stages):
            if s.id != stage_id:
                continue
            if i <= self._index:
                return
            self._done_weight = sum(x.weight for x in self._stages[:i])
            self._index = i
            self._emit(s.label, self._done_weight)
            return

    def detail(self, message: str, within: float = 0.5) -> None:
        """같은 단계 안에서의 소식. 그 단계 가중치의 일부만 더한다."""
        if self._index < 0:
            self._write_human(message)
            return
        weight = self._stages[self._index].weight
        self._emit(message, self._done_weight + weight * max(0.0, min(1.0, within)))

    def done(self, project_path: str, clips: int) -> None:
        if self._json:
            self._write_json({"event": "done", "project": project_path, "clips": clips})
        else:
            self._write_human(f"완료 — 클립 {clips}개 → {project_path}")

    def error(self, reason: str, message: str) -> None:
        if self._json:
            self._write_json({"event": "error", "reason": reason, "message": message})
        else:
            print(f"{message} (사유: {reason})", file=sys.stderr)

    # ── 내부 ──────────────────────────────────────────────

    def _emit(self, label: str, pct: float) -> None:
        if self._json:
            stage_id = self._stages[self._index].id if self._index >= 0 else ""
            self._write_json(
                {"event": "progress", "stage": stage_id, "label": label, "pct": round(min(0.99, pct), 4)}
            )
        else:
            self._write_human(label)

    def _write_json(self, payload: dict[str, object]) -> None:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    def _write_human(self, message: str) -> None:
        print(message)

    # ── 워커 내부에서 쓰는 콜백 ────────────────────────────

    def as_callback(self) -> "ProgressCallback":
        return ProgressCallback(self)


@dataclass
class ProgressCallback:
    """기존 `on_progress(str)` 자리에 그대로 넣을 수 있는 어댑터.

    메시지 앞머리를 보고 어느 단계인지 짐작한다. 못 알아보면 소식으로 흘린다.
    """

    reporter: ProgressReporter
    _hints: dict[str, str] = field(
        default_factory=lambda: {
            "영상 정보": "ingest",
            "영상 받는": "ingest",
            "원본 정리": "ingest",
            "미리보기용": "ingest",
            "음성 추출": "ingest",
            "파형": "ingest",
            "썸네일": "ingest",
            "받아쓰는": "transcribe",
            "하이라이트": "highlight",
            "글 가져오는": "fetch",
            "대본 쓰는": "script",
            "이미지 가져오는": "images",
            "나레이션": "tts",
        }
    )

    def __call__(self, message: str) -> None:
        text = message.strip()
        if not text:
            return
        for needle, stage_id in self._hints.items():
            if text.startswith(needle):
                self.reporter.stage(stage_id)
                return
        # 화면에는 한 줄만 보여 준다. 여러 줄짜리 보고서가 그대로 넘어오면 UI가 깨진다.
        self.reporter.detail(_one_line(text))


def _one_line(text: str, limit: int = 80) -> str:
    first = text.splitlines()[0].strip()
    return first if len(first) <= limit else first[: limit - 1] + "…"
