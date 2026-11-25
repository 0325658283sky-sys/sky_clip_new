"""워커 명령줄.

    skycut-worker transcribe  --audio a.wav --out p.json
    skycut-worker highlight   --project p.json --out p.json [--offline]
    skycut-worker stt-compare --audio a.wav --reference ref.txt --engines elevenlabs,deepgram
    skycut-worker eval-init   --projects fixtures/*.json
    skycut-worker eval        [--offline] [--promote]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import project_io
from .config import (
    EVAL_DIR,
    MEDIA_DIR,
    PROMPT_VERSION,
    WORK_DIR,
    ExtractionRequest,
    RunConfig,
    WindowConfig,
)
from .cost import CostReport
from .evaluation import promote_baseline, run_eval, write_result, write_template
from .highlight import StubLlm, extract_highlights
from .highlight.llm import AnthropicLlm, LlmClient
from .media import MediaStore
from .media.ingest import ingest as ingest_media
from .media.youtube import YoutubeError
from .run import run_pipeline
from .stt import DEFAULT_ENGINE, ENGINES, evaluate_engine, get_transcriber, write_comparison
from .transcript import TranscriptView


def _request_from_args(args: argparse.Namespace) -> ExtractionRequest:
    return ExtractionRequest(
        prompt=getattr(args, "prompt", None),
        min_duration_ms=int(getattr(args, "min_sec", 20) * 1000),
        max_duration_ms=int(getattr(args, "max_sec", 60) * 1000),
        genre=getattr(args, "genre", None),
        max_clips=int(getattr(args, "max_clips", 5)),
    )


def _config_from_args(args: argparse.Namespace) -> RunConfig:
    return RunConfig(
        request=_request_from_args(args),
        window=WindowConfig(size=int(getattr(args, "window", 2000))),
        offline=bool(getattr(args, "offline", False)),
    )


def _llm(view: TranscriptView, cfg: RunConfig, report: CostReport) -> LlmClient:
    if cfg.offline:
        print("  (오프라인 모드 — LLM을 부르지 않습니다. 결과 품질은 의미 없습니다.)")
        return StubLlm(view)
    return AnthropicLlm(cfg, report)


# ── ingest ─────────────────────────────────────────────────


def cmd_ingest(args: argparse.Namespace) -> int:
    store = MediaStore(Path(args.store))
    try:
        result = ingest_media(args.source, store, force=args.force, on_progress=lambda m: print("  " + m))
    except YoutubeError as exc:
        print(f"{exc}  (사유: {exc.reason})", file=sys.stderr)
        return 1
    print(result.summary())
    print(f"  → {store.paths(result.asset_id).dir}")
    return 0


# ── run (전체 연결) ────────────────────────────────────────


def cmd_run(args: argparse.Namespace) -> int:
    store = MediaStore(Path(args.store))
    cfg = _config_from_args(args)
    out = Path(args.out)

    if cfg.offline:
        print("  (오프라인 모드 — LLM을 부르지 않습니다. 결과 품질은 의미 없습니다.)")
    if not args.rights:
        print(
            "경고: --rights 없이 실행했습니다. 사용 권리를 확인했다는 기록이 남지 않습니다.",
            file=sys.stderr,
        )

    try:
        result = run_pipeline(
            args.source,
            out,
            store,
            cfg,
            stt_engine=args.engine,
            rights_attested=bool(args.rights),
            project_id=args.project_id,
            use_comments=not args.no_comments,
            on_progress=lambda m: print(m),
        )
    except YoutubeError as exc:
        print(f"{exc}  (사유: {exc.reason})", file=sys.stderr)
        return 1

    print()
    print(result.summary())
    print(f"  → {out}")

    if result.cost and (result.cost.llm_calls or result.cost.stt):
        print(result.cost.summary())
        cost_path = WORK_DIR / f"{result.project['id']}-cost.json"
        result.cost.write(cost_path)
        print(f"  비용 기록 → {cost_path}")

    if result.clips == 0:
        print("쓸 만한 구간을 찾지 못했습니다.", file=sys.stderr)
        return 1

    print("\n이제 렌더링할 수 있어요:")
    print(f"  npm run render:project -- {out}")
    return 0


# ── transcribe ─────────────────────────────────────────────


def cmd_transcribe(args: argparse.Namespace) -> int:
    audio = Path(args.audio)
    if not audio.exists():
        print(f"오디오 파일이 없습니다: {audio}", file=sys.stderr)
        return 1

    engine = get_transcriber(
        args.engine, project_path=Path(args.from_project) if args.from_project else None
    )
    print(f"받아쓰는 중 ({engine.name}) — {audio.name}")
    result = engine.transcribe(audio, language=args.language)

    if not result.words:
        print("단어를 하나도 받지 못했습니다.", file=sys.stderr)
        return 1

    out_path = Path(args.out)
    project = (
        project_io.load_project(out_path)
        if out_path.exists()
        else project_io.new_project(args.project_id or audio.stem, args.input_kind, args.url, args.rights)
    )
    project["transcript"] = {
        "words": [
            {
                "id": w.id,
                "text": w.text,
                "startMs": w.start_ms,
                "endMs": w.end_ms,
                **({"speakerId": w.speaker_id} if w.speaker_id else {}),
                **({"confidence": w.confidence} if w.confidence is not None else {}),
            }
            for w in result.words
        ],
        "sentences": project_io.sentences_from_words(result.words),
    }
    provenance = dict(project.get("provenance") or {})
    provenance["sttEngine"] = result.engine
    project["provenance"] = provenance

    project_io.write_project(project, out_path)
    print(
        f"  어절 {len(result.words)}개 · 음성 {result.audio_seconds:.0f}초 · "
        f"처리 {result.wall_seconds:.1f}초 ({result.speed_ratio:.2f}x) · ${result.usd:.4f}"
    )
    print(f"  → {out_path}")
    return 0


# ── highlight ──────────────────────────────────────────────


def cmd_highlight(args: argparse.Namespace) -> int:
    project_path = Path(args.project)
    project = project_io.load_project(project_path)
    view = project_io.view_from_project(project)

    cfg = _config_from_args(args)
    cfg.request = project_io.request_from_project(project, cfg.request)
    print(f"하이라이트 추출 — {project['id']} · 어절 {len(view)}개 · {cfg.request.describe()}")

    report = CostReport(project_id=project["id"])
    result = extract_highlights(view, _llm(view, cfg, report), cfg)
    print(result.report())

    stt_engine = (project.get("provenance") or {}).get("sttEngine")
    updated = project_io.attach_clips(project, view, result.clips, cfg, stt_engine)

    out_path = Path(args.out or args.project)
    project_io.write_project(updated, out_path)
    print(f"  → {out_path}")

    if report.llm_calls:
        print(report.summary())
        cost_path = WORK_DIR / f"{project['id']}-cost.json"
        report.write(cost_path)
        print(f"  비용 기록 → {cost_path}")

    if not result.clips:
        print("쓸 만한 구간을 찾지 못했습니다.", file=sys.stderr)
        return 1
    return 0


# ── stt-compare ────────────────────────────────────────────


def cmd_stt_compare(args: argparse.Namespace) -> int:
    audio = Path(args.audio)
    if not audio.exists():
        print(f"오디오 파일이 없습니다: {audio}", file=sys.stderr)
        return 1

    reference_text = Path(args.reference).read_text(encoding="utf-8") if args.reference else None
    reference_words = None
    if args.reference_project:
        ref_view = project_io.view_from_project(project_io.load_project(Path(args.reference_project)))
        reference_words = ref_view.words
        reference_text = reference_text or ref_view.text(0, len(ref_view) - 1)

    if reference_text is None:
        print("기준 대본이 없으면 오인식률을 잴 수 없습니다 (--reference 또는 --reference-project).")

    names = [n.strip() for n in args.engines.split(",") if n.strip()]
    reports = []
    for name in names:
        try:
            engine = get_transcriber(name)
        except Exception as exc:
            print(f"  {name:<12} 건너뜀: {exc}")
            continue
        report, _ = evaluate_engine(engine, audio, reference_text, reference_words, args.language)
        reports.append(report)
        print(report.line())

    if not reports:
        print("비교할 엔진이 없습니다.", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else WORK_DIR / f"stt-compare-{audio.stem}.json"
    write_comparison(out, audio, reports)
    print(f"  → {out}")

    ok = [r for r in reports if r.error is None and r.wer is not None]
    if ok:
        best = min(ok, key=lambda r: r.wer or 1.0)
        print(f"\n오인식률이 가장 낮은 엔진: {best.engine} (WER {best.wer:.3f})")
        print("경계 오차와 비용도 함께 보고 정하세요. 영상 한 개로 정하지 마세요.")
    return 0


# ── eval ───────────────────────────────────────────────────


def cmd_eval_init(args: argparse.Namespace) -> int:
    paths = [Path(p) for p in args.projects]
    missing = [p for p in paths if not p.exists()]
    if missing:
        print("없는 파일: " + ", ".join(str(p) for p in missing), file=sys.stderr)
        return 1
    out = write_template(Path(args.dir), paths)
    print(f"평가셋 틀을 만들었습니다 → {out}")
    print("각 항목의 genre를 적고, labels에 '쇼츠로 쓸 만한 구간'을 ms 단위로 채우세요.")
    print("가능하면 두 사람이 따로 표시해 labeler를 나눠 적습니다.")
    return 0


def cmd_eval(args: argparse.Namespace) -> int:
    root = Path(args.dir)
    cfg = _config_from_args(args)
    run = run_eval(root, cfg, limit=args.limit)
    print(run.summary())

    path = write_result(root, run, cfg, PROMPT_VERSION)
    print(f"\n결과 기록 → {path}")

    if args.promote:
        baseline = promote_baseline(root, path)
        print(f"기준선 갱신 → {baseline}")
    elif run.regressed:
        return 1
    return 0


# ── parser ─────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="skycut-worker", description="SkyCut 분석 워커")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_extraction_opts(p: argparse.ArgumentParser) -> None:
        p.add_argument("--prompt", help="'~에 대한 부분만' 처럼 주제를 지정")
        p.add_argument("--genre", help="예능 / 정보 / 인터뷰 / 강의 / 팟캐스트")
        p.add_argument("--min-sec", type=float, default=20, help="쇼츠 최소 길이 (초)")
        p.add_argument("--max-sec", type=float, default=60, help="쇼츠 최대 길이 (초)")
        p.add_argument("--max-clips", type=int, default=5)
        p.add_argument("--window", type=int, default=2000, help="한 번에 볼 어절 수")
        p.add_argument("--offline", action="store_true", help="LLM 없이 스텁으로 실행")

    i = sub.add_parser("ingest", help="유튜브/MP4 → 에셋(원본·프록시·wav·파형·썸네일)")
    i.add_argument("source", help="유튜브 URL 또는 로컬 영상 파일")
    i.add_argument("--store", default=str(MEDIA_DIR))
    i.add_argument("--force", action="store_true", help="이미 만든 것도 다시 만든다")
    i.set_defaults(func=cmd_ingest)

    r = sub.add_parser("run", help="입력 → 에셋 → 대본 → 하이라이트까지 한 번에")
    r.add_argument("source", help="유튜브 URL 또는 로컬 영상 파일")
    r.add_argument("--out", required=True, help="Project JSON 저장 경로")
    r.add_argument("--store", default=str(MEDIA_DIR))
    r.add_argument("--engine", default=DEFAULT_ENGINE, choices=ENGINES)
    r.add_argument("--project-id")
    r.add_argument("--rights", action="store_true", help="사용 권리를 확인했음")
    r.add_argument("--no-comments", action="store_true", help="유튜브 인기 댓글을 쓰지 않는다")
    add_extraction_opts(r)
    r.set_defaults(func=cmd_run)

    t = sub.add_parser("transcribe", help="오디오 → 대본")
    t.add_argument("--audio", required=True)
    t.add_argument("--out", required=True, help="Project JSON 경로 (있으면 대본만 갱신)")
    t.add_argument("--engine", default=DEFAULT_ENGINE, choices=ENGINES)
    t.add_argument("--from-project", help="fixture 엔진이 읽을 Project JSON")
    t.add_argument("--language", default="ko")
    t.add_argument("--project-id")
    t.add_argument("--input-kind", default="upload", choices=["youtube", "upload", "blog"])
    t.add_argument("--url")
    t.add_argument("--rights", action="store_true", help="사용 권리를 확인했음")
    t.set_defaults(func=cmd_transcribe)

    h = sub.add_parser("highlight", help="대본 → 하이라이트 클립")
    h.add_argument("--project", required=True)
    h.add_argument("--out", help="기본값은 --project 와 같은 파일")
    add_extraction_opts(h)
    h.set_defaults(func=cmd_highlight)

    c = sub.add_parser("stt-compare", help="STT 엔진 비교 실험")
    c.add_argument("--audio", required=True)
    c.add_argument("--reference", help="사람이 고친 기준 대본 (txt)")
    c.add_argument("--reference-project", help="시간 정보까지 있는 기준 Project JSON")
    c.add_argument("--engines", default="elevenlabs,deepgram")
    c.add_argument("--language", default="ko")
    c.add_argument("--out")
    c.set_defaults(func=cmd_stt_compare)

    ei = sub.add_parser("eval-init", help="평가셋 틀 만들기")
    ei.add_argument("--projects", nargs="+", required=True)
    ei.add_argument("--dir", default=str(EVAL_DIR))
    ei.set_defaults(func=cmd_eval_init)

    e = sub.add_parser("eval", help="평가셋으로 품질 측정")
    e.add_argument("--dir", default=str(EVAL_DIR))
    e.add_argument("--limit", type=int)
    e.add_argument("--promote", action="store_true", help="이번 결과를 새 기준선으로 삼는다")
    add_extraction_opts(e)
    e.set_defaults(func=cmd_eval)

    return parser


def _use_utf8_output() -> None:
    """윈도우 콘솔 기본 인코딩(cp949)에서 한국어·기호가 깨지지 않게 한다."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


def main(argv: list[str] | None = None) -> int:
    _use_utf8_output()
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        print("\n중단했습니다.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
