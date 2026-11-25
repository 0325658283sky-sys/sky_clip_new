# SkyCut 아키텍처 (M0 기준)

개발 범위와 단계는 [작업지시서_v3_MVP.md](작업지시서_v3_MVP.md)를 따른다. 이 문서는 **코드가 지켜야 할 규칙**만 적는다.

---

## 1. 절대 규칙

| # | 규칙 | 어기면 생기는 일 |
|---|---|---|
| 1 | **콘텐츠·템플릿·사용자 편집 분리.** 템플릿에서 파생된 값은 저장하지 않는다(bake 금지) | 템플릿 교체 시 사용자 편집이 덮어써짐 |
| 2 | **시간은 원본 기준 정수 ms 또는 `wordId`로만 저장.** 출력 시간·프레임은 `resolve()`가 계산 | 컷 삭제 시 자막·효과 위치가 어긋남 |
| 3 | **좌표·크기는 0~1 정규화 값.** 픽셀 저장 금지 | 프록시(480p) → 원본(1080p) 전환 시 레이아웃이 깨짐 |
| 4 | **에셋은 `assetId` + variant로 참조.** 경로 문자열 저장·치환 금지 | 스토리지 전환(로컬→S3) 시 전부 수정 |
| 5 | **`resolve()`는 결정적 순수 함수.** 난수·현재시각·I/O 금지 | 미리보기와 최종 렌더가 달라짐 |
| 6 | **Zod가 스키마 단일 원천.** JSON Schema와 Pydantic은 생성물 | TS와 Python 스키마가 갈라짐 |
| 7 | **브라우저 인코딩 금지.** 파형·썸네일도 워커가 생성 | Thin client 원칙 위반 |

---

## 2. 데이터 3계층

```
ClipContent   분석 결과 (불변)        ─┐
TemplateSpec  디자인 규칙 (ID 참조)    ├─→ resolve() ─→ ResolvedTimeline ─→ Remotion
ClipOverrides 사용자 편집 diff        ─┘                 (저장 안 함)
```

- 우선순위: `TemplateSpec` < `BrandKit`(MVP 이후) < `ClipOverrides`
- `ClipOverrides.content`(컷·자막 텍스트·제목·효과)는 템플릿 교체 시 **유지**
- `ClipOverrides.style`(폰트·색·위치·애니메이션)은 템플릿 교체 시 **초기화** (`keepStyleOnTemplateChange`로 유지 가능)
- override 항목을 지우면 템플릿 기본값으로 복귀

MVP(초심자 전용)에서는 `overrides`가 비어 있다. 구조만 미리 둔다.

---

## 3. 시간 모델

```
원본 영상  |----------------------------------------|
클립 범위       [=========== clip.range ===========]
삭제 구간            [cut]           [cut]
출력          [===]      [=========]      [======]   ← resolve()가 계산
```

- 저장: `sourceMs`(원본 기준) 또는 `wordId`
- 계산: `buildTimeMap(range, cuts)` → `TimeMap` → `toOutputMs(sourceMs)`
- 앵커(자막·효과·SFX)가 삭제 구간에 걸치면:
  - 전부 삭제 구간 안 → 제거
  - 일부만 걸침 → 남은 구간으로 클리핑
  - 삭제 구간을 가로지름 → 조각으로 분할
- 프레임 변환은 `msToFrame()` 한 곳에서만. fps 기본 30.

---

## 4. 좌표 모델

- 모든 사각형은 `Rect { x, y, w, h }`, 각 값 0~1 (부모 프레임 기준)
- 글자 크기도 `fontSize` 비율 값 (프레임 높이 대비). 1080×1920에서 `0.025` = 48px
- `preview`(480×854)와 `export`(1080×1920)는 같은 정규화 값을 쓰고, 렌더 시점에만 픽셀로 환산

---

## 5. 패키지 구조

```
packages/schema     Zod 스키마(단일 원천) + 생성된 JSON Schema/Pydantic
packages/core       resolve(), 시간 매핑, 자막 줄나눔, 레이아웃 계산  ← 순수 TS, 의존성 없음
packages/templates  테마 A·B TemplateSpec
apps/renderer       Remotion 컴포지션 + 렌더 스크립트
apps/worker         (M1~) Python 분석 CLI
fixtures/           손으로 만든 샘플 Project JSON
```

의존 방향: `templates → schema`, `core → schema`, `renderer → core, templates, schema`. 역방향 금지.

---

## 6. 스키마 생성 흐름

```
packages/schema/src/*.ts  (Zod, 단일 원천)
        │ npm run schema:json
        ▼
packages/schema/generated/*.schema.json  (JSON Schema)
        │ npm run schema:python
        ▼
packages/schema/generated/models.py      (Pydantic v2)
```

- 생성물은 커밋한다(파이썬 쪽에서 생성 도구 없이 쓰기 위해).
- `npm run schema:check`가 생성물이 최신인지 검사한다. CI에서 실패하면 재생성 후 커밋.
- `schemaVersion` 필수. 마이그레이션은 `packages/schema/migrations/`.

---

## 7. 테마 2종 (M0 확정 대상)

| | A. 예능 블랙 | B. 게시물 화이트 |
|---|---|---|
| 배경 | 검정 | 흰색 |
| 구성 | 제목 / 16:9 미디어 / 요약 카드 | 프로필 헤더 / 제목 / 미디어 / 질문 |
| 제목 | 1줄 흰색, 2줄 노랑 | 검정, 키워드만 포인트색 |
| 자막 | 구절 팝인 + 테두리 | 구절 페이드업 + 테두리 |
| 효과 | 효과 텍스트 + 펀치인 줌 | 없음 |

근거: [research/쇼츠_트렌드_조사.md](research/쇼츠_트렌드_조사.md) §7~8
시각 기준: [SkyCut 목업](https://claude.ai/artifact/EiJSSYjaDesPGanT1k87iD)

**둘 다 3단 구성이므로 MVP에 얼굴 추적(reframe)이 필요 없다.**

### 안전 영역 (1080×1920)
상단 288px / 하단 672px / 오른쪽 192px은 쇼츠 앱 UI가 가린다. 정규화로는
`top 0.15 / bottom 0.35 / right 0.178`. 모든 글자는 이 안쪽에 둔다.

---

## 8. 개발 명령

```bash
npm install
npm run build:schema      # Zod 컴파일
npm run schema:json       # JSON Schema 생성
npm run schema:python     # Pydantic 생성 (.venv 필요)
npm test                  # core 단위 테스트
npm run fixtures          # 샘플 Project JSON 생성
npm run render:all        # 샘플 × 테마 2종 MP4 렌더링 → out/
npm run studio            # Remotion Studio
```
