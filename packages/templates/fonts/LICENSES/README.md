# 글꼴 라이선스

| 글꼴 | 용도 | 라이선스 | 배포처 |
|---|---|---|---|
| Black Han Sans | 테마 A 제목, 효과 글자 | SIL Open Font License 1.1 | Google Fonts |
| Noto Sans KR | 자막, 본문, 테마 B 제목 | SIL Open Font License 1.1 | Google Fonts |

## 왜 이 둘인가
- **SIL OFL 1.1은 상업적 이용·임베딩·수정을 허용한다.** 영상에 글자를 넣어 수익 콘텐츠로 쓰는 것에 제약이 없다.
- 한국어 글리프가 충분하고, Noto Sans KR은 100~900 굵기를 제공해 자막·제목·캡션을 한 글꼴로 처리할 수 있다.
- `@remotion/google-fonts`로 불러오므로 **글꼴 파일을 이 저장소에 재배포하지 않는다.** 렌더 시점에 Google Fonts에서 내려받아 쓴다.

## 출시 전 확인할 것
- [ ] 각 글꼴의 공식 배포 페이지에서 OFL 1.1 문구를 직접 확인하고 원문을 이 폴더에 저장
  - Black Han Sans: https://fonts.google.com/specimen/Black+Han+Sans/license
  - Noto Sans KR: https://fonts.google.com/noto/specimen/Noto+Sans+KR/license
- [ ] 렌더 서버가 외부망 없이 돌아야 한다면 글꼴 파일을 번들하고, OFL이 요구하는 대로 라이선스 원문을 함께 포함
- [ ] 브랜드 키트(MVP 이후)에서 사용자가 글꼴을 올릴 수 있게 되면, 업로드 글꼴의 라이선스 책임을 약관에 명시

## 글꼴을 추가할 때
1. 공식 배포처에서 라이선스를 확인하고 원문을 이 폴더에 `<글꼴이름>-LICENSE.txt`로 저장한다.
2. 위 표에 한 줄 추가한다.
3. `apps/renderer/src/fonts.ts`에 등록하고 `TextStyle.fontFamily`의 선택지를 늘린다.
4. 라이선스를 확인하지 못한 글꼴은 **쓰지 않는다.**
