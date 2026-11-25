/**
 * 글꼴.
 *
 * 둘 다 Google Fonts에 있는 SIL Open Font License 1.1 글꼴이라
 * 상업적 이용과 영상 삽입이 허용된다. 라이선스 원문은 fonts/LICENSES/ 참고.
 *   - Black Han Sans : 제목 (굵은 한 가지 굵기)
 *   - Noto Sans KR   : 자막·본문 (100~900)
 */
import { loadFont as loadBlackHanSans } from '@remotion/google-fonts/BlackHanSans';
import { loadFont as loadNotoSansKR } from '@remotion/google-fonts/NotoSansKR';

// 필요한 굵기·문자셋만 받는다 (전체를 받으면 요청이 1000건을 넘어 렌더가 느려진다)
const blackHanSans = loadBlackHanSans('normal', {
  weights: ['400'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
});
const notoSansKR = loadNotoSansKR('normal', {
  weights: ['400', '500', '700', '900'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
});

export const FONT_FAMILY = {
  title: `${blackHanSans.fontFamily}, ${notoSansKR.fontFamily}, sans-serif`,
  body: `${notoSansKR.fontFamily}, sans-serif`,
} as const;

/** 모든 글꼴이 준비될 때까지 기다린다 (서버 렌더에서 첫 프레임이 깨지지 않도록) */
export const fontsReady = Promise.all([blackHanSans.waitUntilDone(), notoSansKR.waitUntilDone()]);
