"""한국어 어절 분류.

LLM 없이 돌아가는 규칙이라 결과가 항상 같고 테스트할 수 있다.
사전은 보수적으로 둔다 — 잘못 지우면 말이 깨지므로, 놓치는 쪽이 낫다.
"""
from __future__ import annotations

import re

#: 말버릇. 지워도 뜻이 변하지 않는 것만 넣는다.
FILLERS: frozenset[str] = frozenset(
    {
        "어", "음", "아", "엄", "그", "저", "에",
        "어어", "음음", "그그", "아아",
        "뭐랄까", "뭐지", "그러니까", "뭐냐면", "그게",
        "아니", "자",
    }
)

#: 앞 내용을 받는 접속어. 구간 맨 앞에 있으면 잘라낸다.
LEADING_CONNECTORS: frozenset[str] = frozenset(
    {
        "그래서", "그러니까", "그런데", "근데", "그리고", "그러면", "그럼",
        "그래도", "하지만", "그러나", "또", "또한", "그러다가", "그랬더니",
        "이제", "일단", "아무튼", "어쨌든", "결국",
    }
)

#: 앞을 봐야만 뜻이 통하는 지시어. 구간이 이걸로 시작하면 혼자 봐서는 이해되지 않는다.
DANGLING_REFERENCES: frozenset[str] = frozenset(
    {
        "그거", "그걸", "그게", "그건", "그때", "그분", "그거는", "그걸로",
        "이거", "이걸", "이게", "이건", "저거", "저걸", "저게",
        "아까", "방금", "앞서", "거기", "저기서", "여기서",
        "걔", "걔가", "쟤", "쟤가",
    }
)

#: 문장이 끝났다고 볼 수 있는 어미
SENTENCE_END_RE = re.compile(
    r"(다|요|죠|까|니|네|군|야|라|자|죠\?|요\?|까\?|니\?)[.!?]?$|[.!?]$"
)

_PUNCT_RE = re.compile(r"[.,!?~…\"'“”‘’()\[\]]+")


def normalize(token: str) -> str:
    """구두점을 떼고 비교용으로 정규화한다."""
    return _PUNCT_RE.sub("", token).strip()


def is_filler(token: str) -> bool:
    return normalize(token) in FILLERS


def is_leading_connector(token: str) -> bool:
    return normalize(token) in LEADING_CONNECTORS


def is_dangling_reference(token: str) -> bool:
    return normalize(token) in DANGLING_REFERENCES


def looks_like_sentence_end(token: str) -> bool:
    t = normalize(token)
    if not t:
        return False
    return bool(SENTENCE_END_RE.search(token)) or bool(SENTENCE_END_RE.search(t))


def strip_particles(token: str) -> str:
    """조사를 떼어 낸 대략의 어간. 중복 판정에만 쓴다 (정확한 형태소 분석이 아니다)."""
    t = normalize(token)
    for p in ("으로써", "으로서", "에서는", "에게서", "이라고", "라고", "에서", "에게", "부터", "까지",
              "으로", "로서", "로써", "하고", "이랑", "처럼", "보다", "마저", "조차",
              "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "와", "과", "로"):
        if len(t) > len(p) + 1 and t.endswith(p):
            return t[: -len(p)]
    return t
