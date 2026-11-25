import { z } from 'zod';
import { AssetVariant, Hex, Id, Norm, Rect } from './primitives.js';
import { TextStyle } from './template.js';

/**
 * resolve()의 출력. **절대 저장하지 않는다.**
 * 여기서만 출력(컷 반영) 시간을 쓰며, 단위는 ms. 프레임 변환은 렌더러가 한다.
 */

const OutMs = z.int().min(0).describe('출력 기준 밀리초 (컷 반영 후)');

export const MediaSegment = z.object({
  outStartMs: OutMs,
  outEndMs: OutMs,
  sourceStartMs: z.int().min(0),
  sourceEndMs: z.int().min(0),
  /** 없으면 textCard만 그리는 구간 */
  assetId: Id.optional(),
  variant: AssetVariant,
  /** 원본 프레임에서 잘라낼 영역 (정규화) */
  crop: Rect,
  kenBurns: z.object({ scaleFrom: z.number(), scaleTo: z.number(), panXNorm: z.number() }).optional(),
  textCard: z.string().optional(),
});
export type MediaSegment = z.infer<typeof MediaSegment>;

export const TextSpan = z.object({ text: z.string(), color: Hex });

export const ResolvedTitle = z.object({
  lines: z.array(z.array(TextSpan)),
  rect: Rect,
  style: TextStyle,
});
export type ResolvedTitle = z.infer<typeof ResolvedTitle>;

export const ResolvedCaption = z.object({
  outStartMs: OutMs,
  outEndMs: OutMs,
  spans: z.array(TextSpan),
  animation: z.enum(['pop', 'fade_up', 'none']),
  animationMs: z.int(),
});
export type ResolvedCaption = z.infer<typeof ResolvedCaption>;

/** 자막 배치는 클립 전체에 공통이라 타임라인 레벨에 둔다. */
export const ResolvedCaptionLayout = z.object({
  anchor: z.enum(['media_bottom', 'frame']),
  rect: Rect,
  style: TextStyle,
});
export type ResolvedCaptionLayout = z.infer<typeof ResolvedCaptionLayout>;

export const ResolvedOverlay = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('profile_header'),
    rect: Rect,
    initial: z.string().max(2),
    name: z.string(),
    handle: z.string(),
    avatarBg: Hex,
    avatarFg: Hex,
    nameStyle: TextStyle,
    handleStyle: TextStyle,
  }),
  z.object({
    kind: z.literal('bottom_card'),
    rect: Rect,
    shape: z.enum(['card', 'plain']),
    bg: Hex.optional(),
    radiusNorm: z.number(),
    label: z.string().optional(),
    labelStyle: TextStyle.optional(),
    text: z.string(),
    textStyle: TextStyle,
  }),
  z.object({ kind: z.literal('credit'), rect: Rect, text: z.string(), style: TextStyle }),
  z.object({
    kind: z.literal('effect_text'),
    outStartMs: OutMs,
    outEndMs: OutMs,
    rect: Rect,
    text: z.string(),
    style: TextStyle,
    rotateDeg: z.number(),
  }),
]);
export type ResolvedOverlay = z.infer<typeof ResolvedOverlay>;

export const ZoomKeyframe = z.object({
  outStartMs: OutMs,
  outEndMs: OutMs,
  scale: z.number().min(1).max(1.5),
});

export const DuckRange = z.object({ outStartMs: OutMs, outEndMs: OutMs });

export const ResolvedAudio = z.object({
  kind: z.enum(['original', 'tts', 'bgm']),
  assetId: Id.optional(),
  outStartMs: OutMs,
  outEndMs: OutMs,
  sourceStartMs: z.int().min(0).default(0),
  gainDb: z.number(),
  /** 이 트랙이 낮아져야 하는 구간 (TTS가 말하는 동안) */
  duckRanges: z.array(DuckRange).default([]),
  duckingDb: z.number().default(0),
  duckAttackMs: z.int().default(120),
  duckReleaseMs: z.int().default(300),
});
export type ResolvedAudio = z.infer<typeof ResolvedAudio>;

export const ResolvedBackground = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: Hex }),
  z.object({
    kind: z.literal('blurred_media'),
    blurPx: z.number(),
    dim: Norm,
    fallbackColor: Hex,
  }),
]);

export const ResolvedTimeline = z.object({
  clipId: Id,
  templateId: Id,
  width: z.int().positive(),
  height: z.int().positive(),
  fps: z.int().positive(),
  durationMs: OutMs,
  durationInFrames: z.int().positive(),
  background: ResolvedBackground,
  mediaRect: Rect,
  mediaRadiusNorm: z.number(),
  segments: z.array(MediaSegment),
  title: ResolvedTitle.optional(),
  captionLayout: ResolvedCaptionLayout,
  captions: z.array(ResolvedCaption),
  overlays: z.array(ResolvedOverlay),
  zooms: z.array(ZoomKeyframe),
  audio: z.array(ResolvedAudio),
});
export type ResolvedTimeline = z.infer<typeof ResolvedTimeline>;
