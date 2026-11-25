"""에셋 저장소.

데이터에는 **경로가 아니라 assetId**만 들어간다(ARCHITECTURE.md 규칙 4).
variants 값은 저장소 루트 기준 상대 경로라서, 로컬에서 S3로 옮겨도
데이터는 그대로다.

    <store>/<assetId>/source.mp4      최종 렌더용 1080p
                     /proxy.mp4       미리보기용 480p
                     /audio16k.wav    STT 입력
                     /waveform.json   타임라인 파형 (스키마 밖, 규약으로 찾는다)
                     /thumbs.jpg      타임라인 썸네일 스트립
                     /meta.json       출처와 원본 정보
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SOURCE = "source.mp4"
PROXY = "proxy.mp4"
WAV = "audio16k.wav"
WAVEFORM = "waveform.json"
THUMBS = "thumbs.jpg"
META = "meta.json"

_SAFE_ID = re.compile(r"[^A-Za-z0-9_-]")


def asset_id_for_youtube(video_id: str) -> str:
    return f"yt-{_SAFE_ID.sub('', video_id)[:32]}"


def asset_id_for_file(path: Path, chunk: int = 1 << 20) -> str:
    """파일 내용으로 ID를 만든다. 같은 파일을 두 번 올려도 한 번만 처리한다."""
    digest = hashlib.sha256()
    digest.update(str(path.stat().st_size).encode())
    with path.open("rb") as fh:
        digest.update(fh.read(chunk))
    return f"up-{digest.hexdigest()[:16]}"


@dataclass(frozen=True)
class AssetPaths:
    root: Path
    asset_id: str

    @property
    def dir(self) -> Path:
        return self.root / self.asset_id

    def path(self, name: str) -> Path:
        return self.dir / name

    def rel(self, name: str) -> str:
        """저장소 루트 기준 상대 경로. variants에 들어가는 값이다."""
        return f"{self.asset_id}/{name}"

    def exists(self, name: str) -> bool:
        return self.path(name).exists()


class MediaStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    def paths(self, asset_id: str) -> AssetPaths:
        return AssetPaths(self.root, asset_id)

    def reserve(self, asset_id: str) -> AssetPaths:
        p = self.paths(asset_id)
        p.dir.mkdir(parents=True, exist_ok=True)
        return p

    def write_json(self, asset_id: str, name: str, payload: Any) -> None:
        path = self.paths(asset_id).path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def read_meta(self, asset_id: str) -> dict[str, Any] | None:
        path = self.paths(asset_id).path(META)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def asset_entry(
        self,
        asset_id: str,
        *,
        kind: str,
        width: int | None = None,
        height: int | None = None,
        duration_ms: int | None = None,
    ) -> dict[str, Any]:
        """스키마의 Asset 모양으로 만든다. 실제로 있는 variant만 넣는다."""
        p = self.paths(asset_id)
        variants: dict[str, str] = {}
        for key, name in (("source", SOURCE), ("proxy", PROXY), ("wav16k", WAV)):
            if p.exists(name):
                variants[key] = p.rel(name)

        entry: dict[str, Any] = {"id": asset_id, "kind": kind, "variants": variants}
        if width:
            entry["width"] = width
        if height:
            entry["height"] = height
        if duration_ms:
            entry["durationMs"] = duration_ms
        return entry
