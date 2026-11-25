/**
 * 쇼츠 앱 UI 안전 영역 (1080×1920 기준 정규화).
 *
 * 출처마다 수치가 달라 가장 보수적인 값을 쓴다.
 * (research/쇼츠_트렌드_조사.md §3)
 *   상단 288px / 하단 672px / 오른쪽 192px
 *
 * 모든 글자는 top ~ bottom 사이, right 왼쪽에 둔다.
 */
export const SAFE = {
  top: 288 / 1920, // 0.15
  bottom: 1 - 672 / 1920, // 0.65  — 이 아래는 채널명·설명·구독 버튼이 가린다
  /** 하단 461px 지점. 이 아래는 설명이 길면 가려질 수 있다. */
  bottomSoft: 1 - 461 / 1920, // 0.7599
  right: 1 - 192 / 1080, // 0.8222
} as const;

/** 16:9 미디어의 정규화 높이 (너비 비율 w 기준, 1080×1920 프레임) */
export function media16x9Height(w: number): number {
  return (w * 1080 * 9) / 16 / 1920;
}

/** 픽셀(1080×1920 기준) → 정규화 */
export const px = {
  x: (v: number) => v / 1080,
  y: (v: number) => v / 1920,
};
