# SkyCut 워커 (M1)

영상 → 대본 → **하이라이트 구간**까지. 결과는 Project JSON으로 나오고, 그대로 렌더러가 읽는다.

```
오디오 ──transcribe──▶ 대본 ──highlight──▶ 클립이 든 Project JSON ──▶ 렌더러(M0)
```

---

## 설치

저장소 루트에서:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e apps/worker
```

STT 공급자는 쓰는 것만 설치한다. ElevenLabs는 REST로 부르므로 추가 설치가 없다.

```bash
.venv/Scripts/python -m pip install -e "apps/worker[deepgram]"
```

### API 키

저장소 루트 `.env`에 넣는다. **채팅이나 코드에 키를 쓰지 않는다.**

```
ANTHROPIC_API_KEY=...
ELEVENLABS_API_KEY=...
DEEPGRAM_API_KEY=...

# 공식 문서에 금액이 없어 비용 집계는 꺼져 있다. 가입 후 요금 페이지를 보고 채운다.
ELEVENLABS_USD_PER_HOUR=
DEEPGRAM_USD_PER_MINUTE=
```

키가 없어도 `--offline`으로 파이프라인 전체를 돌려 볼 수 있다. 결과 품질은 의미가 없고, 형식과 흐름만 확인하는 용도다.

---

## 명령

```bash
skycut-worker transcribe --audio sample.wav --out out/p.json --engine elevenlabs --rights
```

```bash
skycut-worker highlight --project out/p.json --genre 예능 --min-sec 20 --max-sec 60
```

```bash
skycut-worker stt-compare --audio sample.wav --reference ref.txt --engines elevenlabs,deepgram
```

```bash
skycut-worker eval-init --projects eval/projects/*.json
```

```bash
skycut-worker eval --promote
```

설치 없이 돌릴 때는 `PYTHONPATH=apps/worker python -m skycut_worker.cli ...`.

---

## 하이라이트 추출 방식

```
주제 나누기 → 후보 찾기 → 경계 다듬기 → 검증 → 채점 → 선택 → 제목·카드·효과
   (LLM)        (LLM)       (코드)      (코드)   (LLM)   (코드)      (LLM)
```

**좋은 쇼츠 구간의 조건** — 후보를 찾을 때도, 채점할 때도 같은 기준을 쓴다.

1. 혼자 봐도 이해된다. "아까 그거"처럼 앞을 가리키는 말로 시작하지 않는다.
2. 첫 3초에 붙잡는 것이 있다.
3. 결론이나 반응에서 깔끔하게 끝난다.
4. 웃기거나 쓸모 있거나 놀랍거나 공감된다.

### LLM에게 단어 ID 대신 정수 인덱스를 준다

ID는 지어내기 쉽지만 정수는 범위 검사만으로 걸러진다. 대본은 `[12]단어` 형태로 주고, 받은 인덱스는 전부 검증을 거쳐야 쓴다.

### 코드가 하는 일 (LLM을 믿지 않는 부분)

| 단계 | 하는 일 |
|---|---|
| 경계 다듬기 | 문장 시작·끝으로 맞추고, 앞뒤 말버릇과 접속어를 걷어낸다 |
| 검증 | 범위 밖 인덱스, 길이 미달·초과, 지시어로 시작, 겹침·중복을 버린다 |
| 선택 | 점수 순으로 상위 N개 |

이 세 단계는 LLM을 부르지 않으므로 **결과가 항상 같고 테스트할 수 있다.**

### 겹침 판정

IoU만 보면 길이가 다른 두 구간이 크게 겹쳐도 통과한다. 짧은 쪽 기준 포함률(`containment`)도 함께 본다. 경계를 문장에 맞추는 과정에서 구간이 서로 번지는 일이 실제로 생긴다.

---

## 품질 관리

"볼 만한 구간을 고르는가"가 경쟁력의 핵심이므로, 프롬프트·모델·STT를 바꿀 때마다 같은 자로 잰다.

```
eval/
  dataset.json        평가셋과 정답 라벨 (사람이 채운다)
  ratings.json        만들어진 클립에 사람이 매긴 평점 (선택)
  baseline.json       기준선 지표
  results/<시각>.json  실행 기록
```

**지표**

| 이름 | 뜻 |
|---|---|
| 적중률@5 | 상위 5개 중 정답 구간과 충분히(IoU ≥ 0.5) 겹치는 비율 |
| 정답 발견율 | 사람이 표시한 정답 중 몇 개를 찾아냈는가 |
| 3개 이상 생성 | 영상당 후보를 3개 이상 낸 비율 (M1 Gate) |
| 평균 평점 | 사람이 매긴 1~5점 |
| 바로 공유 가능 | 수정 없이 올릴 수 있다고 판정된 비율 (출시 판정 지표) |

`eval`은 기준선보다 떨어지면 **종료 코드 1**로 끝난다. 그대로 CI에 걸 수 있다. 결과가 좋아 기준선을 올릴 때만 `--promote`를 쓴다.

정답 라벨은 **시간(ms) 기준**으로 적는다. 단어 인덱스는 STT 엔진이 바뀌면 달라져 엔진 간 비교가 되지 않는다.

---

## STT 비교 실험 (M1에서 엔진을 정하는 단계)

업체가 내놓은 한국어 WER 수치는 서로 맞지 않는다. 우리 영상으로 직접 잰다.

```bash
skycut-worker stt-compare --audio sample.wav --reference ref.txt --engines elevenlabs,deepgram
```

재는 것: 오인식률(WER·CER), **단어 시간 오차**, 처리 속도, 비용.

자막 싱크는 단어 시간 오차에 달려 있다. 100ms를 넘으면 눈에 띈다. `--reference-project`로 시간까지 든 기준 대본을 주면 이 값을 잰다.

### 공급자 구현 상태

| 공급자 | 상태 |
|---|---|
| `elevenlabs` | REST 직접 호출. 요청·응답 모양을 공식 문서에서 확인함 |
| `deepgram` | SDK 호출 경로와 응답 모양은 확인함. **`language`·`diarize`·`punctuate` 파라미터 이름은 미확인** — 거부되면 무엇을 고칠지 알려 주고 멈춘다 |
| `fixture` | 이미 대본이 든 Project JSON에서 읽는다 (개발·테스트용) |

---

## 테스트

```bash
cd apps/worker && ../../.venv/Scripts/python -m pytest -q
```

LLM을 부르지 않는 부분은 전부 테스트가 있다. 파이프라인 전체는 스텁 LLM으로 돌려 흐름과 형식을 확인한다.
