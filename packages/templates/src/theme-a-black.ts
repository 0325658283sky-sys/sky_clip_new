import type { TemplateSpec } from '@skycut/schema';
import { media16x9Height, px, SAFE } from './safe-area.js';

/**
 * 테마 A — 예능 블랙 (3단 구성, 검정 배경)
 *
 * 근거: research/쇼츠_트렌드_조사.md §8
 * 시각 기준: https://claude.ai/artifact/EiJSSYjaDesPGanT1k87iD
 *
 * 세로 배치 (정규화, 1080×1920):
 *   0.150  안전 영역 시작
 *   0.155  제목 (2줄)        ~0.227
 *   0.238  미디어 16:9        ~0.554
 *   0.567  하단 카드          ~0.623
 *   0.631  출처               ~0.647
 *   0.650  안전 영역 끝 (이 아래는 앱 UI가 가림)
 */

const MEDIA_Y = 0.238;
const MEDIA_H = media16x9Height(1);
const CAPTION_INSET = px.y(24);

export const themeABlack: TemplateSpec = {
  id: 'a-black',
  name: '예능 블랙',
  description: '검정 배경 3단 구성. 제목은 흰색+노란색 2줄, 강조 순간에 효과 글자와 줌이 들어간다.',
  suitedFor: ['예능', '토크', '인터뷰', '리액션'],
  frame: { width: 1080, height: 1920, fps: 30 },

  background: { kind: 'solid', color: '#000000' },

  media: {
    rect: { x: 0, y: MEDIA_Y, w: 1, h: MEDIA_H },
    aspect: '16:9',
    radiusNorm: 0,
    kenBurns: { enabled: true, scaleTo: 1.12, panXNorm: -0.03 },
  },

  profileHeader: {
    show: false,
    rect: { x: 0.05, y: 0.152, w: 0.9, h: 0.04 },
    nameStyle: { fontFamily: 'body', fontWeight: 700, fontSize: px.y(34), lineHeight: 1.25, letterSpacingEm: 0, color: '#ffffff', align: 'left', stroke: { widthEm: 0, color: '#000000' } },
    handleStyle: { fontFamily: 'body', fontWeight: 500, fontSize: px.y(26), lineHeight: 1.25, letterSpacingEm: 0, color: '#9ca3af', align: 'left', stroke: { widthEm: 0, color: '#000000' } },
    avatarBg: '#2a2d34',
    avatarFg: '#ffd400',
  },

  title: {
    rect: { x: 0.055, y: 0.155, w: 0.89, h: 0.072 },
    style: {
      fontFamily: 'title',
      fontWeight: 400, // Black Han Sans는 단일 굵기
      fontSize: px.y(62),
      lineHeight: 1.18,
      letterSpacingEm: -0.01,
      color: '#ffffff',
      align: 'center',
      stroke: { widthEm: 0, color: '#000000' },
    },
    line2Color: '#ffd400',
    keywordColor: '#ffd400',
    maxLines: 2,
    maxCharsPerLine: 12,
  },

  caption: {
    anchor: 'media_bottom',
    rect: { x: 0.05, y: MEDIA_Y, w: 0.9, h: MEDIA_H - CAPTION_INSET },
    style: {
      fontFamily: 'body',
      fontWeight: 900,
      fontSize: px.y(46),
      lineHeight: 1.25,
      letterSpacingEm: -0.01,
      color: '#ffffff',
      align: 'center',
      stroke: { widthEm: 0.1, color: '#000000' },
    },
    animation: 'pop',
    animationMs: 280,
    // 국내 표본에서 단어별 색 강조는 거의 쓰지 않아 기본 off (조사 §7.2)
    wordHighlight: 'none',
    highlightColor: '#ffd400',
    grouping: { maxChars: 14, maxWords: 3, minDurationMs: 500 },
  },

  bottomCard: {
    show: true,
    rect: { x: 0.055, y: 0.567, w: 0.89, h: 0.056 },
    shape: 'card',
    bg: '#1d1f24',
    radiusNorm: 0.008,
    labelStyle: {
      fontFamily: 'body', fontWeight: 700, fontSize: px.y(24), lineHeight: 1.3,
      letterSpacingEm: 0, color: '#ffd400', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    textStyle: {
      fontFamily: 'body', fontWeight: 700, fontSize: px.y(32), lineHeight: 1.35,
      letterSpacingEm: 0, color: '#ffffff', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  credit: {
    show: true,
    rect: { x: 0.055, y: 0.631, w: 0.89, h: 0.016 },
    style: {
      fontFamily: 'body', fontWeight: 500, fontSize: px.y(24), lineHeight: 1.25,
      letterSpacingEm: 0, color: '#a1a1aa', align: 'center', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  effects: {
    punchIn: { enabled: true, scale: 1.1, durationMs: 500 },
    effectText: {
      enabled: true,
      rect: { x: 0.58, y: 0.252, w: 0.37, h: 0.055 },
      style: {
        fontFamily: 'title', fontWeight: 400, fontSize: px.y(72), lineHeight: 1,
        letterSpacingEm: 0, color: '#ffd400', align: 'right', stroke: { widthEm: 0.08, color: '#000000' },
      },
      rotateDeg: -8,
      durationMs: 900,
    },
  },

  audio: {
    bgmGainDb: -22,
    originalGainDb: 0,
    ttsGainDb: 0,
    duckingDb: -12,
    duckAttackMs: 120,
    duckReleaseMs: 300,
  },

  autoEdit: { removeFillers: true, removeSilenceOverMs: 700 },
  ttsMode: 'none',
};

// 안전 영역 밖으로 나가면 개발 중 바로 알 수 있도록
const lowest = themeABlack.credit.rect.y + themeABlack.credit.rect.h;
if (lowest > SAFE.bottom) {
  throw new Error(`테마 A의 하단 요소가 안전 영역을 넘습니다: ${lowest} > ${SAFE.bottom}`);
}
