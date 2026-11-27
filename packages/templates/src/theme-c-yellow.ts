import type { TemplateSpec } from '@skycut/schema';
import { media16x9Height, px, SAFE } from './safe-area.js';

/**
 * 테마 C — 옐로 SNS (화이트 배경 + 노란 헤드라인)
 *
 * 레퍼런스: https://www.canva.com/ko_kr/templates/EAGZK7Lbbjc/
 * 화이트 배경, 노란 타이틀 강조, 카드형 하단
 *
 * 세로 배치 (정규화, 1080×1920):
 *   0.150  안전 영역 시작
 *   0.155  제목 (2줄)        ~0.230
 *   0.242  미디어 16:9 (폭 0.9) ~0.556
 *   0.568  하단 카드          ~0.624
 *   0.630  출처               ~0.646
 *   0.650  안전 영역 끝
 */

const MEDIA_W = 0.9;
const MEDIA_X = (1 - MEDIA_W) / 2;
const MEDIA_Y = 0.242;
const MEDIA_H = media16x9Height(MEDIA_W);
const CAPTION_INSET = px.y(24);

export const themeCYellow: TemplateSpec = {
  id: 'c-yellow',
  name: '옐로 SNS',
  description: '화이트 배경에 노란 헤드라인. 밝고 활발한 SNS 스타일로 음식·라이프스타일에 잘 맞는다.',
  suitedFor: ['라이프스타일', '음식', '뷰티', '일상', '꿀팁'],
  frame: { width: 1080, height: 1920, fps: 30 },

  background: { kind: 'solid', color: '#fffdf0' },

  media: {
    rect: { x: MEDIA_X, y: MEDIA_Y, w: MEDIA_W, h: MEDIA_H },
    aspect: '16:9',
    radiusNorm: 0.014,
    kenBurns: { enabled: true, scaleTo: 1.08, panXNorm: 0.02 },
  },

  profileHeader: {
    show: false,
    rect: { x: 0.055, y: 0.152, w: 0.89, h: 0.038 },
    nameStyle: {
      fontFamily: 'body', fontWeight: 900, fontSize: px.y(32), lineHeight: 1.22,
      letterSpacingEm: 0, color: '#111111', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    handleStyle: {
      fontFamily: 'body', fontWeight: 500, fontSize: px.y(24), lineHeight: 1.22,
      letterSpacingEm: 0, color: '#6b7280', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    avatarBg: '#ffd600',
    avatarFg: '#78350f',
  },

  title: {
    rect: { x: 0.05, y: 0.155, w: 0.9, h: 0.080 },
    style: {
      fontFamily: 'title',
      fontWeight: 400,
      fontSize: px.y(60),
      lineHeight: 1.2,
      letterSpacingEm: -0.01,
      color: '#111111',
      align: 'center',
      stroke: { widthEm: 0, color: '#000000' },
    },
    line2Color: '#ffd600',
    keywordColor: '#ffd600',
    maxLines: 2,
    maxCharsPerLine: 13,
  },

  caption: {
    anchor: 'media_bottom',
    rect: { x: MEDIA_X + 0.02, y: MEDIA_Y, w: MEDIA_W - 0.04, h: MEDIA_H - CAPTION_INSET },
    style: {
      fontFamily: 'body',
      fontWeight: 900,
      fontSize: px.y(44),
      lineHeight: 1.25,
      letterSpacingEm: -0.01,
      color: '#ffffff',
      align: 'center',
      stroke: { widthEm: 0.09, color: '#333333' },
    },
    animation: 'pop',
    animationMs: 260,
    wordHighlight: 'none',
    highlightColor: '#ffd600',
    grouping: { maxChars: 14, maxWords: 3, minDurationMs: 500 },
  },

  bottomCard: {
    show: true,
    rect: { x: 0.055, y: 0.568, w: 0.89, h: 0.056 },
    shape: 'card',
    bg: '#ffd600',
    radiusNorm: 0.009,
    labelStyle: {
      fontFamily: 'body', fontWeight: 700, fontSize: px.y(24), lineHeight: 1.3,
      letterSpacingEm: 0, color: '#78350f', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    textStyle: {
      fontFamily: 'body', fontWeight: 800, fontSize: px.y(32), lineHeight: 1.35,
      letterSpacingEm: 0, color: '#111111', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  credit: {
    show: true,
    rect: { x: 0.055, y: 0.630, w: 0.89, h: 0.016 },
    style: {
      fontFamily: 'body', fontWeight: 500, fontSize: px.y(24), lineHeight: 1.25,
      letterSpacingEm: 0, color: '#9ca3af', align: 'center', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  effects: {
    punchIn: { enabled: true, scale: 1.07, durationMs: 400 },
    effectText: { enabled: false, rotateDeg: 0, durationMs: 600 },
  },

  audio: {
    bgmGainDb: -24,
    originalGainDb: 0,
    ttsGainDb: 0,
    duckingDb: -12,
    duckAttackMs: 120,
    duckReleaseMs: 300,
  },

  autoEdit: { removeFillers: true, removeSilenceOverMs: 650 },
  ttsMode: 'none',
};

const lowest = themeCYellow.credit.rect.y + themeCYellow.credit.rect.h;
if (lowest > SAFE.bottom) {
  throw new Error(`테마 C의 하단 요소가 안전 영역을 넘습니다: ${lowest} > ${SAFE.bottom}`);
}
