import type { TemplateSpec } from '@skycut/schema';
import { media16x9Height, px, SAFE } from './safe-area.js';

/**
 * 테마 B — 게시물 화이트 (3단 + 프로필 헤더, 흰 배경)
 *
 * 근거: research/쇼츠_트렌드_조사.md §8
 * 블로그 입력의 기본 테마. 효과는 절제한다.
 *
 * 세로 배치 (정규화, 1080×1920):
 *   0.150  안전 영역 시작
 *   0.152  프로필 헤더        ~0.190
 *   0.198  제목 (2줄)        ~0.276
 *   0.284  미디어 16:9 (폭 0.92) ~0.575
 *   0.588  질문 한 줄         ~0.616
 *   0.622  출처               ~0.638
 *   0.650  안전 영역 끝
 */

const MEDIA_W = 0.92;
const MEDIA_X = (1 - MEDIA_W) / 2;
const MEDIA_Y = 0.284;
const MEDIA_H = media16x9Height(MEDIA_W);
const CAPTION_INSET = px.y(24);

export const themeBWhite: TemplateSpec = {
  id: 'b-white',
  name: '게시물 화이트',
  description: '흰 배경 게시물형. 상단 프로필 헤더와 질문 한 줄로 끝낸다. 효과는 쓰지 않는다.',
  suitedFor: ['정보', '꿀팁', '블로그 요약', '뉴스'],
  frame: { width: 1080, height: 1920, fps: 30 },

  background: { kind: 'solid', color: '#ffffff' },

  media: {
    rect: { x: MEDIA_X, y: MEDIA_Y, w: MEDIA_W, h: MEDIA_H },
    aspect: '16:9',
    radiusNorm: 0.012,
    kenBurns: { enabled: true, scaleTo: 1.1, panXNorm: -0.025 },
  },

  profileHeader: {
    show: true,
    rect: { x: 0.055, y: 0.152, w: 0.89, h: 0.038 },
    nameStyle: {
      fontFamily: 'body', fontWeight: 900, fontSize: px.y(32), lineHeight: 1.22,
      letterSpacingEm: 0, color: '#111111', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    handleStyle: {
      fontFamily: 'body', fontWeight: 500, fontSize: px.y(24), lineHeight: 1.22,
      letterSpacingEm: 0, color: '#6b7280', align: 'left', stroke: { widthEm: 0, color: '#000000' },
    },
    avatarBg: '#ffe1d2',
    avatarFg: '#c2410c',
  },

  title: {
    rect: { x: 0.05, y: 0.198, w: 0.9, h: 0.078 },
    style: {
      fontFamily: 'body',
      fontWeight: 900,
      fontSize: px.y(58),
      lineHeight: 1.26,
      letterSpacingEm: -0.025,
      color: '#111111',
      align: 'center',
      stroke: { widthEm: 0, color: '#000000' },
    },
    keywordColor: '#e8470f',
    maxLines: 2,
    maxCharsPerLine: 14,
  },

  caption: {
    anchor: 'media_bottom',
    rect: { x: MEDIA_X + 0.02, y: MEDIA_Y, w: MEDIA_W - 0.04, h: MEDIA_H - CAPTION_INSET },
    style: {
      fontFamily: 'body',
      fontWeight: 700,
      fontSize: px.y(42),
      lineHeight: 1.25,
      letterSpacingEm: -0.01,
      color: '#ffffff',
      align: 'center',
      stroke: { widthEm: 0.09, color: '#000000' },
    },
    animation: 'fade_up',
    animationMs: 350,
    wordHighlight: 'none',
    grouping: { maxChars: 16, maxWords: 3, minDurationMs: 600 },
  },

  bottomCard: {
    show: true,
    rect: { x: 0.06, y: 0.588, w: 0.88, h: 0.028 },
    shape: 'plain',
    radiusNorm: 0,
    textStyle: {
      fontFamily: 'body', fontWeight: 900, fontSize: px.y(38), lineHeight: 1.3,
      letterSpacingEm: -0.01, color: '#111111', align: 'center', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  credit: {
    show: true,
    rect: { x: 0.06, y: 0.622, w: 0.88, h: 0.016 },
    style: {
      fontFamily: 'body', fontWeight: 500, fontSize: px.y(24), lineHeight: 1.25,
      letterSpacingEm: 0, color: '#6b7280', align: 'center', stroke: { widthEm: 0, color: '#000000' },
    },
  },

  effects: {
    punchIn: { enabled: false, scale: 1.04, durationMs: 400 },
    effectText: { enabled: false, rotateDeg: 0, durationMs: 600 },
  },

  audio: {
    bgmGainDb: -26,
    originalGainDb: -6,
    ttsGainDb: 0,
    duckingDb: -14,
    duckAttackMs: 150,
    duckReleaseMs: 350,
  },

  autoEdit: { removeFillers: true, removeSilenceOverMs: 600 },
  ttsMode: 'full_narration',
};

const lowest = themeBWhite.credit.rect.y + themeBWhite.credit.rect.h;
if (lowest > SAFE.bottom) {
  throw new Error(`테마 B의 하단 요소가 안전 영역을 넘습니다: ${lowest} > ${SAFE.bottom}`);
}
