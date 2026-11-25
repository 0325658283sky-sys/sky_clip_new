# SkyCut

영상 링크·MP4·블로그 주소를 넣으면 **바로 올릴 수 있는 쇼츠**를 만들어 주는 서비스.

- 개발 범위와 단계: [작업지시서_v3_MVP.md](작업지시서_v3_MVP.md)
- 코드 규칙: [ARCHITECTURE.md](ARCHITECTURE.md)
- 테마 근거: [research/쇼츠_트렌드_조사.md](research/쇼츠_트렌드_조사.md)
- 화면 기준: [SkyCut 목업](https://claude.ai/artifact/EiJSSYjaDesPGanT1k87iD)

**현재 단계: M3 (블로그 입력)** — M0(뼈대·테마), M1(하이라이트 엔진), M2(영상 연결) 코드 완료

```bash
skycut-worker run "https://youtu.be/..." --out out/p.json --rights --genre 예능
```

```bash
skycut-worker run "https://blog.naver.com/.../123" --out out/p.json --rights
```

```bash
npm run render:project -- out/p.json
```

---

## 처음 받았을 때

```bash
npm install
python -m venv .venv
.venv/Scripts/python -m pip install pydantic datamodel-code-generator
.venv/Scripts/python -m pip install -e apps/worker
```

API 키는 저장소 루트 `.env`에 넣는다 ([apps/worker/README.md](apps/worker/README.md) 참고). 키가 없어도 `--offline`으로 워커를 돌려 볼 수 있다.

## 자주 쓰는 명령

```bash
npm test                 # core 단위 테스트 (M0 Gate a~f)
```

```bash
cd apps/worker && ../../.venv/Scripts/python -m pytest -q    # 워커 테스트 (M1)
```

```bash
npm run fixtures         # 샘플 Project JSON 4개 생성 → fixtures/
```

```bash
npm run render:all       # 샘플 × 테마 2종 MP4 + 썸네일 → out/
```

```bash
npm run render:project -- out/p.json          # 워커가 만든 Project → out/shorts/
```

```bash
npm run render:all -- --still fx-video-ramen--a-black
```

```bash
npm run studio           # Remotion Studio에서 미리보기
```

```bash
npm run schema:json && npm run schema:python   # Zod → JSON Schema → Pydantic
```

```bash
npx tsx tools/roundtrip-check.ts        # TS ↔ Python 왕복 검증
```

```bash
npx tsx tools/compare-preview-export.ts # 미리보기 vs 최종 렌더 SSIM 비교
```

---

## 폴더

| 경로 | 내용 |
|---|---|
| `packages/schema` | Zod 스키마(**단일 원천**) + 생성된 JSON Schema·Pydantic |
| `packages/core` | `resolve()`, 시간 매핑, 자막 묶기 — 순수 TS |
| `packages/templates` | 테마 A(예능 블랙)·B(게시물 화이트) |
| `apps/renderer` | Remotion 컴포지션 + 렌더 스크립트 |
| `apps/worker` | 대본·하이라이트 추출·품질 평가 ([README](apps/worker/README.md)) |
| `fixtures/` | 손으로 만든 샘플 Project JSON |
| `out/` | 렌더 결과 (커밋하지 않음) |

---

## 바꾸면 안 되는 것

1. 시간은 **원본 기준 ms**로만 저장한다. 출력 시간은 `resolve()`가 계산한다.
2. 좌표·크기는 **0~1 정규화 값**으로만 저장한다.
3. 템플릿에서 나온 값을 저장 데이터에 **굽지 않는다**.
4. `resolve()`는 **결정적 순수 함수**다.
5. 스키마는 Zod에서만 고치고, Pydantic은 재생성한다.

자세한 이유는 [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 글꼴

| 용도 | 글꼴 | 라이선스 |
|---|---|---|
| 제목 | Black Han Sans | SIL Open Font License 1.1 (상업적 이용 가능) |
| 자막·본문 | Noto Sans KR | SIL Open Font License 1.1 (상업적 이용 가능) |

둘 다 Google Fonts에서 `@remotion/google-fonts`로 불러온다.
