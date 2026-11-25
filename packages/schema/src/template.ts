import { z } from 'zod';
import { Hex, Id, Norm, Rect } from './primitives.js';

/** 글자 크기는 프레임 높이 대비 비율. 1080×1920에서 0.025 ≈ 48px */
const FontSize = z.number().min(0.005).max(0.2);

export const TextStroke = z.object({
  widthEm: z.number().min(0).max(0.4).default(0),
  color: Hex.default('#000000'),
});

export const TextStyle = z.object({
  fontFamily: z.enum(['title', 'body']),
  fontWeight: z.int().min(100).max(900).default(700),
  fontSize: FontSize,
  lineHeight: z.number().min(0.8).max(2.5).default(1.2),
  letterSpacingEm: z.number().min(-0.1).max(0.3).default(0),
  color: Hex,
  align: z.enum(['left', 'center', 'right']).default('center'),
  stroke: TextStroke.default({ widthEm: 0, color: '#000000' }),
});
export type TextStyle = z.infer<typeof TextStyle>;

export const BackgroundSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: Hex }),
  z.object({
    kind: z.literal('blurred_media'),
    blurPx: z.number().min(0).max(120).default(48),
    dim: Norm.default(0.45),
    fallbackColor: Hex.default('#000000'),
  }),
]);

export const TitleSpec = z.object({
  rect: Rect,
  style: TextStyle,
  /** 2줄 구성에서 2번째 줄에만 적용할 색 (없으면 style.color) */
  line2Color: Hex.optional(),
  /** 제목 안의 키워드 강조색 */
  keywordColor: Hex.optional(),
  maxLines: z.int().min(1).max(3).default(2),
  maxCharsPerLine: z.int().min(4).max(30).default(12),
});

export const CaptionSpec = z.object({
  /** media_bottom: 미디어 하단 안쪽 / frame: 프레임 기준 rect */
  anchor: z.enum(['media_bottom', 'frame']),
  rect: Rect,
  style: TextStyle,
  animation: z.enum(['pop', 'fade_up', 'none']).default('pop'),
  animationMs: z.int().min(0).max(1000).default(280),
  /** 단어 단위 색 강조. 국내 표본에서는 거의 쓰지 않아 기본 off (조사 §7.2) */
  wordHighlight: z.enum(['none', 'color']).default('none'),
  highlightColor: Hex.optional(),
  /** 한 번에 보여줄 묶음 크기 */
  grouping: z.object({
    maxChars: z.int().min(4).max(40).default(14),
    maxWords: z.int().min(1).max(8).default(3),
    minDurationMs: z.int().min(100).max(3000).default(500),
  }),
});

export const MediaSpec = z.object({
  rect: Rect,
  /** 가운데 미디어의 가로세로비. 3단 구성은 16:9 원본을 그대로 쓴다. */
  aspect: z.enum(['16:9', '4:5', '9:16']).default('16:9'),
  radiusNorm: z.number().min(0).max(0.1).default(0),
  /** 이미지 입력(블로그)에서 천천히 확대·이동 */
  kenBurns: z.object({
    enabled: z.boolean().default(false),
    scaleTo: z.number().min(1).max(1.5).default(1.12),
    panXNorm: z.number().min(-0.2).max(0.2).default(-0.03),
  }).default({ enabled: false, scaleTo: 1.12, panXNorm: -0.03 }),
});

export const ProfileHeaderSpec = z.object({
  show: z.boolean(),
  rect: Rect,
  nameStyle: TextStyle,
  handleStyle: TextStyle,
  avatarBg: Hex.default('#ffe1d2'),
  avatarFg: Hex.default('#c2410c'),
});

export const BottomCardSpec = z.object({
  show: z.boolean(),
  rect: Rect,
  /** card: 배경 있는 카드 / plain: 배경 없는 한 줄 */
  shape: z.enum(['card', 'plain']).default('card'),
  bg: Hex.optional(),
  radiusNorm: z.number().min(0).max(0.05).default(0.01),
  labelStyle: TextStyle.optional(),
  textStyle: TextStyle,
});

export const CreditSpec = z.object({
  show: z.boolean(),
  rect: Rect,
  style: TextStyle,
});

export const EffectsSpec = z.object({
  /** 강조 순간 살짝 확대 */
  punchIn: z.object({
    enabled: z.boolean().default(false),
    scale: z.number().min(1).max(1.4).default(1.1),
    durationMs: z.int().min(80).max(1500).default(500),
  }),
  /** "ㅋㅋㅋ", "오호?" 같은 효과 글자 */
  effectText: z.object({
    enabled: z.boolean().default(false),
    rect: Rect.optional(),
    style: TextStyle.optional(),
    rotateDeg: z.number().min(-30).max(30).default(-8),
    durationMs: z.int().min(200).max(3000).default(900),
  }),
});

export const AudioSpec = z.object({
  bgmPresetId: z.string().max(64).optional(),
  bgmGainDb: z.number().min(-60).max(6).default(-22),
  originalGainDb: z.number().min(-60).max(6).default(0),
  ttsGainDb: z.number().min(-60).max(6).default(0),
  /** TTS가 말하는 동안 원본·BGM을 낮추는 정도 */
  duckingDb: z.number().min(-40).max(0).default(-12),
  duckAttackMs: z.int().min(0).max(1000).default(120),
  duckReleaseMs: z.int().min(0).max(2000).default(300),
});

export const AutoEditSpec = z.object({
  removeFillers: z.boolean().default(true),
  removeSilenceOverMs: z.int().min(0).max(5000).default(700),
});

/** 디자인·효과 규칙. 콘텐츠를 전혀 담지 않는다. */
export const TemplateSpec = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(''),
  suitedFor: z.array(z.string().max(30)).default([]),
  frame: z.object({
    width: z.int().positive().default(1080),
    height: z.int().positive().default(1920),
    fps: z.int().min(24).max(60).default(30),
  }),
  background: BackgroundSpec,
  media: MediaSpec,
  profileHeader: ProfileHeaderSpec,
  title: TitleSpec,
  caption: CaptionSpec,
  bottomCard: BottomCardSpec,
  credit: CreditSpec,
  effects: EffectsSpec,
  audio: AudioSpec,
  autoEdit: AutoEditSpec,
  ttsMode: z.enum(['none', 'intro_hook', 'full_narration']),
});
export type TemplateSpec = z.infer<typeof TemplateSpec>;
