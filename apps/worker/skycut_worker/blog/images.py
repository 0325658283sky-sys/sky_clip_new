"""블로그 이미지를 에셋 저장소로 가져온다.

남의 블로그 사진을 쓰게 되므로 권리 확인이 전제다(작업지시서 v3 §9).
너무 작거나 아이콘인 이미지는 화면을 채우지 못하므로 거른다.
"""
from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass
from pathlib import Path

from ..media.store import MediaStore

#: 가운데 미디어를 채우려면 이 정도는 돼야 한다
MIN_WIDTH = 480
MIN_HEIGHT = 270
MAX_BYTES = 12 * 1024 * 1024

_EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


@dataclass
class StoredImage:
    asset_id: str
    asset: dict[str, object]
    url: str
    width: int
    height: int


def _dimensions(data: bytes) -> tuple[int, int]:
    """헤더만 읽어 크기를 본다. 외부 의존성 없이 jpg/png/gif/webp를 다룬다."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) > 10:
        return struct.unpack("<HH", data[6:10])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8X" and len(data) > 30:
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h
        if data[12:16] == b"VP8 " and len(data) > 30:
            return (
                int.from_bytes(data[26:28], "little") & 0x3FFF,
                int.from_bytes(data[28:30], "little") & 0x3FFF,
            )
        return 0, 0
    if data[:2] == b"\xff\xd8":  # JPEG — SOF 세그먼트를 찾는다
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height = int.from_bytes(data[i + 5 : i + 7], "big")
                width = int.from_bytes(data[i + 7 : i + 9], "big")
                return width, height
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            i += 2 + int.from_bytes(data[i + 2 : i + 4], "big")
        return 0, 0
    return 0, 0


def download_images(urls: list[str], store: MediaStore, referer: str = "") -> dict[str, StoredImage]:
    """URL → 저장된 이미지. 가져오지 못한 것은 결과에 없다."""
    import httpx

    from .fetch import USER_AGENT

    out: dict[str, StoredImage] = {}
    headers = {"User-Agent": USER_AGENT, "Accept": "image/*"}
    if referer:
        headers["Referer"] = referer  # 네이버는 레퍼러가 없으면 막는 경우가 있다

    with httpx.Client(headers=headers, follow_redirects=True, timeout=httpx.Timeout(30.0)) as client:
        for url in urls:
            try:
                response = client.get(url)
                response.raise_for_status()
            except httpx.HTTPError:
                continue

            data = response.content
            if len(data) > MAX_BYTES or not data:
                continue

            width, height = _dimensions(data)
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                continue  # 아이콘·버튼·프로필 사진

            ext = _EXT_BY_TYPE.get(response.headers.get("content-type", "").split(";")[0].strip().lower())
            if ext is None:
                continue

            asset_id = "img-" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
            paths = store.reserve(asset_id)
            name = f"source.{ext}"
            if not paths.exists(name):
                paths.path(name).write_bytes(data)
            store.write_json(asset_id, "meta.json", {"sourceKind": "blog_image", "url": url})

            out[url] = StoredImage(
                asset_id=asset_id,
                asset={
                    "id": asset_id,
                    "kind": "image",
                    "variants": {"source": f"{asset_id}/{name}"},
                    "width": width,
                    "height": height,
                },
                url=url,
                width=width,
                height=height,
            )
    return out


def store_root_note(store: MediaStore) -> Path:
    return store.root
