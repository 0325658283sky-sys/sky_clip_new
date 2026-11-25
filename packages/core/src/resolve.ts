/**
 * resolve(): 콘텐츠 + 템플릿 + 사용자 편집 → 렌더 직전 타임라인.
 *
 * **결정적 순수 함수여야 한다.** 난수·현재시각·I/O 금지 (ARCHITECTURE.md 규칙 5).
 * 미리보기(@remotion/player)와 서버 렌더가 같은 결과를 쓰기 위한 유일한 지점.
 */
import type {
  Clip,
  ClipOverrides,
  MediaSegment,
  Project,
  RenderMode,
  ResolvedAudio,
  ResolvedCaption,
  ResolvedCaptionLayout,
  ResolvedOverlay,
  ResolvedTimeline,
  ResolvedTitle,
  TemplateSpec,
  TextStyle,
  TitleCandidate,
} from '@skycut/schema';
import { EMPTY_OVERRIDES } from '@skycut/schema';
import {
  buildTimeMap,
  durationToFrames,
  mapRange,
  mergeOutRanges,
  normalizeRanges,
  type Range,
  type TimeMap,
} from './time.js';
import { groupWords, timingsToWords, type TimedWord } from './text.js';

/** 미리보기 해상도. 9:16 비율은 export와 동일하게 유지한다. */
export const PREVIEW_SIZE = { width: 540, height: 960 } as const;

/** 한국어 TTS 대략 속도 (초당 글자). 실제 음성이 없을 때 길이 추정용. */
const CHARS_PER_SEC = 5.5;

const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 } as const;

export interface ResolveInput {
  project: Project;
  clip: Clip;
  template: TemplateSpec;
  mode: RenderMode;
}

interface BaseMediaSpan {
  baseStartMs: number;
  baseEndMs: number;
  assetId?: string;
  textCard?: string;
  kenBurns: boolean;
}

interface BaseTimeline {
  range: Range;
  words: TimedWord[];
  sentenceBreakAfter: Set<string>;
  mediaSpans: BaseMediaSpan[];
  effectAnchors: { baseMs: number; text: string }[];
  ttsSpans: { assetId: string; baseStartMs: number; baseEndMs: number }[];
  /** 자동 삭제 후보 (단어 단위) */
  fillerRanges: Range[];
  silenceRanges: Range[];
}

/* ─────────────── 1. 원본 기준 기본 타임라인 ─────────────── */

function buildBase(project: Project, clip: Clip): BaseTimeline {
  return clip.content.kind === 'video_excerpt'
    ? buildVideoBase(project, clip)
    : buildNarratedBase(project, clip);
}

function buildVideoBase(project: Project, clip: Clip): BaseTimeline {
  const words = project.transcript?.words ?? [];
  const range = clip.content.range;
  const startIdx = range ? words.findIndex((w) => w.id === range.startWordId) : 0;
  const endIdx = range ? words.findIndex((w) => w.id === range.endWordId) : words.length - 1;
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error(`클립 ${clip.id}: 하이라이트 구간의 단어 ID를 대본에서 찾을 수 없습니다.`);
  }

  const slice = words.slice(startIdx, endIdx + 1);
  const first = slice[0]!;
  const last = slice[slice.length - 1]!;
  const clipRange: Range = { startMs: first.startMs, endMs: last.endMs };

  const sentenceBreakAfter = new Set<string>();
  for (const s of project.transcript?.sentences ?? []) sentenceBreakAfter.add(s.endWordId);

  const byId = new Map(slice.map((w) => [w.id, w]));
  const fillerRanges: Range[] = [];
  for (const id of clip.content.autoEdit.fillerWordIds) {
    const w = byId.get(id);
    if (w) fillerRanges.push({ startMs: w.startMs, endMs: w.endMs });
  }

  const effectAnchors = clip.content.effectMoments
    .map((m) => {
      const w = m.anchorWordId ? byId.get(m.anchorWordId) : undefined;
      return w ? { baseMs: w.startMs, text: m.text } : null;
    })
    .filter((x): x is { baseMs: number; text: string } => x !== null);

  return {
    range: clipRange,
    words: slice.map((w) => ({ id: w.id, text: w.text, startMs: w.startMs, endMs: w.endMs })),
    sentenceBreakAfter,
    mediaSpans: project.sourceAssetId
      ? [{ baseStartMs: clipRange.startMs, baseEndMs: clipRange.endMs, assetId: project.sourceAssetId, kenBurns: false }]
      : [],
    effectAnchors,
    ttsSpans: [],
    fillerRanges,
    silenceRanges: clip.content.autoEdit.silenceRangesMs.map((r) => ({ startMs: r.startMs, endMs: r.endMs })),
  };
}

function buildNarratedBase(project: Project, clip: Clip): BaseTimeline {
  const ttsByScene = new Map(clip.generated.filter((g) => g.sceneId).map((g) => [g.sceneId!, g]));
  const words: TimedWord[] = [];
  const sentenceBreakAfter = new Set<string>();
  const mediaSpans: BaseMediaSpan[] = [];
  const ttsSpans: { assetId: string; baseStartMs: number; baseEndMs: number }[] = [];
  const effectAnchors: { baseMs: number; text: string }[] = [];
  const anchorByScene = new Map(
    clip.content.effectMoments.filter((m) => m.anchorSceneId).map((m) => [m.anchorSceneId!, m.text]),
  );

  let cursor = 0;
  for (const scene of clip.content.scenes) {
    const tts = ttsByScene.get(scene.id);
    const durationMs = tts?.durationMs ?? estimateSpeechMs(scene.narration);

    const sceneWords =
      tts && tts.wordTimings.length > 0
        ? timingsToWords(tts.wordTimings, scene.id, cursor)
        : spreadEvenly(scene.narration, scene.id, cursor, durationMs);
    words.push(...sceneWords);
    const lastWord = sceneWords[sceneWords.length - 1];
    if (lastWord) sentenceBreakAfter.add(lastWord.id);

    mediaSpans.push({
      baseStartMs: cursor,
      baseEndMs: cursor + durationMs,
      assetId: scene.imageAssetId,
      textCard: scene.textCard,
      kenBurns: true,
    });
    if (tts) ttsSpans.push({ assetId: tts.assetId, baseStartMs: cursor, baseEndMs: cursor + durationMs });

    const fx = anchorByScene.get(scene.id);
    if (fx) effectAnchors.push({ baseMs: cursor + Math.min(300, durationMs / 2), text: fx });

    cursor += durationMs;
  }

  const total = clip.narrationDurationMs ?? cursor;
  return {
    range: { startMs: 0, endMs: total },
    words,
    sentenceBreakAfter,
    mediaSpans,
    effectAnchors,
    ttsSpans,
    fillerRanges: [],
    silenceRanges: [],
  };
}

function estimateSpeechMs(text: string): number {
  const chars = text.replace(/\s/g, '').length;
  return Math.max(800, Math.round((chars / CHARS_PER_SEC) * 1000));
}

function spreadEvenly(text: string, idPrefix: string, offsetMs: number, durationMs: number): TimedWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const totalChars = tokens.reduce((n, t) => n + t.length, 0);
  let cursor = offsetMs;
  return tokens.map((t, i) => {
    const share = Math.round((t.length / totalChars) * durationMs);
    const startMs = cursor;
    cursor += Math.max(120, share);
    return { id: `${idPrefix}-${i}`, text: t, startMs, endMs: Math.min(cursor, offsetMs + durationMs) };
  });
}

/* ─────────────── 2. 컷 수집 ─────────────── */

function collectCuts(base: BaseTimeline, template: TemplateSpec, overrides: ClipOverrides, words: TimedWord[]): Range[] {
  const keep = new Set(overrides.content.keepWordIds);
  const wordById = new Map(words.map((w) => [w.id, w]));
  const cuts: Range[] = [];

  if (template.autoEdit.removeFillers) {
    for (const r of base.fillerRanges) {
      // 사용자가 되살린 단어는 제외
      const kept = [...keep].some((id) => {
        const w = wordById.get(id);
        return w && w.startMs === r.startMs && w.endMs === r.endMs;
      });
      if (!kept) cuts.push(r);
    }
  }

  const minSilence = template.autoEdit.removeSilenceOverMs;
  if (minSilence > 0) {
    for (const r of base.silenceRanges) {
      if (r.endMs - r.startMs >= minSilence) cuts.push(r);
    }
  }

  for (const c of overrides.content.cuts) cuts.push({ startMs: c.startMs, endMs: c.endMs });
  return normalizeRanges(cuts);
}

/* ─────────────── 3. 템플릿 교체 ─────────────── */

/**
 * 템플릿을 바꿀 때 오버라이드를 어떻게 넘길지.
 * content(컷·텍스트)는 유지, style(색·폰트)은 초기화가 기본.
 */
export function overridesForTemplateChange(overrides: ClipOverrides): ClipOverrides {
  return {
    content: overrides.content,
    style: overrides.keepStyleOnTemplateChange ? overrides.style : {},
    keepStyleOnTemplateChange: overrides.keepStyleOnTemplateChange,
  };
}

/* ─────────────── 4. resolve ─────────────── */

export function resolve(input: ResolveInput): ResolvedTimeline {
  const { project, clip, template, mode } = input;
  const overrides = clip.overrides ?? EMPTY_OVERRIDES;
  const style = overrides.style;

  const base = buildBase(project, clip);
  const cuts = collectCuts(base, template, overrides, base.words);
  const map = buildTimeMap(base.range, cuts);

  const width = mode === 'export' ? template.frame.width : PREVIEW_SIZE.width;
  const height = mode === 'export' ? template.frame.height : PREVIEW_SIZE.height;
  const fps = template.frame.fps;
  const variant = mode === 'export' ? 'source' : 'proxy';

  return {
    clipId: clip.id,
    templateId: template.id,
    width,
    height,
    fps,
    durationMs: map.durationMs,
    durationInFrames: durationToFrames(map.durationMs, fps),
    background: resolveBackground(template, style.backgroundColor),
    mediaRect: template.media.rect,
    mediaRadiusNorm: template.media.radiusNorm,
    segments: resolveSegments(base, map, template, variant, overrides),
    title: resolveTitle(clip, template, style),
    captionLayout: resolveCaptionLayout(template, style),
    captions: resolveCaptions(base, map, template, style, overrides),
    overlays: resolveOverlays(project, clip, template, base, map),
    zooms: resolveZooms(base, map, template),
    audio: resolveAudio(project, clip, template, base, map, style),
  };
}

function resolveBackground(template: TemplateSpec, override?: string): ResolvedTimeline['background'] {
  const bg = template.background;
  if (bg.kind === 'solid') return { kind: 'solid', color: override ?? bg.color };
  if (override) return { kind: 'solid', color: override };
  return { kind: 'blurred_media', blurPx: bg.blurPx, dim: bg.dim, fallbackColor: bg.fallbackColor };
}

function resolveSegments(
  base: BaseTimeline,
  map: TimeMap,
  template: TemplateSpec,
  variant: 'source' | 'proxy',
  overrides: ClipOverrides,
): MediaSegment[] {
  const crop = overrides.content.mediaCrop ?? FULL_FRAME;
  const kb = template.media.kenBurns;
  const out: MediaSegment[] = [];

  for (const span of base.mediaSpans) {
    for (const piece of mapRange(map, span.baseStartMs, span.baseEndMs)) {
      if (!span.assetId) {
        if (span.textCard) {
          out.push({
            outStartMs: piece.outStartMs,
            outEndMs: piece.outEndMs,
            sourceStartMs: piece.sourceStartMs,
            sourceEndMs: piece.sourceEndMs,
            variant,
            crop,
            textCard: span.textCard,
          });
        }
        continue;
      }
      const seg: MediaSegment = {
        outStartMs: piece.outStartMs,
        outEndMs: piece.outEndMs,
        sourceStartMs: piece.sourceStartMs,
        sourceEndMs: piece.sourceEndMs,
        assetId: span.assetId,
        variant,
        crop,
      };
      if (span.kenBurns && kb.enabled) {
        seg.kenBurns = { scaleFrom: 1, scaleTo: kb.scaleTo, panXNorm: kb.panXNorm };
      }
      if (span.textCard) seg.textCard = span.textCard;
      out.push(seg);
    }
  }
  return out.sort((a, b) => a.outStartMs - b.outStartMs);
}

function pickTitle(clip: Clip): TitleCandidate {
  const o = clip.overrides?.content.titleOverride;
  if (o) return o;
  const list = clip.content.titles;
  return list[clip.selectedTitleIndex] ?? list[0]!;
}

function resolveTitle(clip: Clip, template: TemplateSpec, style: ClipOverrides['style']): ResolvedTitle | undefined {
  const t = pickTitle(clip);
  if (!t) return undefined;

  const spec = template.title;
  const baseColor = style.titleColor ?? spec.style.color;
  const line2Color = style.titleLine2Color ?? spec.line2Color ?? baseColor;
  const keywordColor = spec.keywordColor ?? line2Color;

  const line1 = t.line1 ? [{ text: t.line1, color: baseColor }] : [];
  const line2: { text: string; color: string }[] = [];
  if (t.line2) {
    const span = t.keywordSpan;
    if (span && span.end > span.start && span.end <= t.line2.length) {
      const before = t.line2.slice(0, span.start);
      const mid = t.line2.slice(span.start, span.end);
      const after = t.line2.slice(span.end);
      if (before) line2.push({ text: before, color: line2Color });
      line2.push({ text: mid, color: keywordColor });
      if (after) line2.push({ text: after, color: line2Color });
    } else {
      line2.push({ text: t.line2, color: line2Color });
    }
  }

  return {
    lines: [line1, line2].filter((l) => l.length > 0).slice(0, spec.maxLines),
    rect: spec.rect,
    style: { ...spec.style, color: baseColor },
  };
}

function scaleStyle(style: TextStyle, factor?: number): TextStyle {
  if (!factor || factor === 1) return style;
  return { ...style, fontSize: style.fontSize * factor };
}

function resolveCaptions(
  base: BaseTimeline,
  map: TimeMap,
  template: TemplateSpec,
  style: ClipOverrides['style'],
  overrides: ClipOverrides,
): ResolvedCaption[] {
  const spec = template.caption;
  const edited = overrides.content.captionText;
  // 잘려 나간 단어는 자막에서도 빠진다 (자동 삭제 결과를 굽지 않고 여기서 계산)
  const words = base.words
    .filter((w) => mapRange(map, w.startMs, w.endMs).length > 0)
    .map((w) => (edited[w.id] ? { ...w, text: edited[w.id]! } : w));
  const groups = groupWords(words, spec.grouping, base.sentenceBreakAfter);

  const color = style.captionColor ?? spec.style.color;
  const highlight = spec.wordHighlight === 'color' ? (spec.highlightColor ?? color) : null;

  const out: ResolvedCaption[] = [];
  for (const g of groups) {
    const merged = mergeOutRanges(mapRange(map, g.startMs, g.endMs));
    if (!merged) continue; // 전부 삭제 구간 안 → 자막도 사라진다
    const spans = highlight
      ? g.words.map((w, i) => ({ text: i === 0 ? w.text : ` ${w.text}`, color: i === 0 ? highlight : color }))
      : [{ text: g.text, color }];
    out.push({
      outStartMs: merged.outStartMs,
      outEndMs: Math.max(merged.outEndMs, merged.outStartMs + 1),
      spans,
      animation: spec.animation,
      animationMs: spec.animationMs,
    });
  }
  // 겹침 제거
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    if (a.outEndMs > b.outStartMs) a.outEndMs = Math.max(a.outStartMs + 1, b.outStartMs);
  }
  return out;
}

function resolveCaptionLayout(template: TemplateSpec, style: ClipOverrides['style']): ResolvedCaptionLayout {
  const spec = template.caption;
  const color = style.captionColor ?? spec.style.color;
  return {
    anchor: spec.anchor,
    rect: spec.rect,
    style: scaleStyle({ ...spec.style, color }, style.captionFontScale),
  };
}

function profileOf(project: Project): { initial: string; name: string; handle: string } {
  // 미결 #6: 영상 입력일 때 어떤 이름을 쓸지 확정 전이라 기본값을 쓴다.
  if (project.article?.blogName) {
    return {
      initial: project.article.blogName.slice(0, 1),
      name: project.article.blogName,
      handle: project.input.url ? hostOf(project.input.url) : '',
    };
  }
  return { initial: '내', name: '내 채널', handle: '@my.channel' };
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m?.[1] ?? '';
}

function resolveOverlays(
  project: Project,
  clip: Clip,
  template: TemplateSpec,
  base: BaseTimeline,
  map: TimeMap,
): ResolvedOverlay[] {
  const out: ResolvedOverlay[] = [];

  if (template.profileHeader.show) {
    const p = profileOf(project);
    out.push({
      kind: 'profile_header',
      rect: template.profileHeader.rect,
      initial: p.initial,
      name: p.name,
      handle: p.handle,
      avatarBg: template.profileHeader.avatarBg,
      avatarFg: template.profileHeader.avatarFg,
      nameStyle: template.profileHeader.nameStyle,
      handleStyle: template.profileHeader.handleStyle,
    });
  }

  const card = clip.content.bottomCard;
  const cardText = clip.overrides?.content.bottomCardText ?? card?.text;
  if (template.bottomCard.show && cardText) {
    const spec = template.bottomCard;
    const label =
      card?.kind === 'real_comment'
        ? `댓글 ${card.authorMasked ? `· ${card.authorMasked}` : ''}`.trim()
        : card?.kind === 'question'
          ? undefined
          : '한줄 요약';
    out.push({
      kind: 'bottom_card',
      rect: spec.rect,
      shape: spec.shape,
      bg: spec.bg,
      radiusNorm: spec.radiusNorm,
      label: spec.shape === 'card' ? label : undefined,
      labelStyle: spec.labelStyle,
      text: cardText,
      textStyle: spec.textStyle,
    });
  }

  if (template.credit.show && clip.content.credit) {
    const c = clip.content.credit;
    out.push({
      kind: 'credit',
      rect: template.credit.rect,
      text: `출처: ${c.channelName}${c.videoTitle ? ` · ${c.videoTitle}` : ''}`,
      style: template.credit.style,
    });
  }

  const fx = template.effects.effectText;
  if (fx.enabled && fx.rect && fx.style) {
    const anchors = [...base.effectAnchors].sort((a, b) => a.baseMs - b.baseMs);
    for (const a of anchors) {
      const piece = mapRange(map, a.baseMs, a.baseMs + fx.durationMs);
      const merged = mergeOutRanges(piece);
      if (!merged) continue;
      out.push({
        kind: 'effect_text',
        outStartMs: merged.outStartMs,
        outEndMs: Math.max(merged.outEndMs, merged.outStartMs + 1),
        rect: fx.rect,
        text: a.text,
        style: fx.style,
        rotateDeg: fx.rotateDeg,
      });
    }
  }

  return out;
}

function resolveZooms(base: BaseTimeline, map: TimeMap, template: TemplateSpec): ResolvedTimeline['zooms'] {
  const p = template.effects.punchIn;
  if (!p.enabled) return [];
  const out: ResolvedTimeline['zooms'] = [];
  for (const a of base.effectAnchors) {
    const merged = mergeOutRanges(mapRange(map, a.baseMs, a.baseMs + p.durationMs));
    if (!merged) continue;
    out.push({ outStartMs: merged.outStartMs, outEndMs: Math.max(merged.outEndMs, merged.outStartMs + 1), scale: p.scale });
  }
  return out.sort((a, b) => a.outStartMs - b.outStartMs);
}

function resolveAudio(
  project: Project,
  clip: Clip,
  template: TemplateSpec,
  base: BaseTimeline,
  map: TimeMap,
  style: ClipOverrides['style'],
): ResolvedAudio[] {
  const a = template.audio;
  const out: ResolvedAudio[] = [];

  // TTS가 말하는 구간 — 덕킹 계산의 기준
  const duckRanges: { outStartMs: number; outEndMs: number }[] = [];
  for (const span of base.ttsSpans) {
    for (const piece of mapRange(map, span.baseStartMs, span.baseEndMs)) {
      duckRanges.push({ outStartMs: piece.outStartMs, outEndMs: piece.outEndMs });
      out.push({
        kind: 'tts',
        assetId: span.assetId,
        outStartMs: piece.outStartMs,
        outEndMs: piece.outEndMs,
        sourceStartMs: piece.sourceStartMs - span.baseStartMs,
        gainDb: style.ttsGainDb ?? a.ttsGainDb,
        duckRanges: [],
        duckingDb: 0,
        duckAttackMs: a.duckAttackMs,
        duckReleaseMs: a.duckReleaseMs,
      });
    }
  }

  const duckingDb = style.duckingDb ?? a.duckingDb;

  if (clip.content.kind === 'video_excerpt' && project.sourceAssetId) {
    for (const seg of map.segments) {
      out.push({
        kind: 'original',
        assetId: project.sourceAssetId,
        outStartMs: seg.outStartMs,
        outEndMs: seg.outEndMs,
        sourceStartMs: seg.sourceStartMs,
        gainDb: style.originalGainDb ?? a.originalGainDb,
        duckRanges: duckRanges.filter((d) => d.outEndMs > seg.outStartMs && d.outStartMs < seg.outEndMs),
        duckingDb,
        duckAttackMs: a.duckAttackMs,
        duckReleaseMs: a.duckReleaseMs,
      });
    }
  }

  if (a.bgmPresetId) {
    out.push({
      kind: 'bgm',
      assetId: a.bgmPresetId,
      outStartMs: 0,
      outEndMs: map.durationMs,
      sourceStartMs: 0,
      gainDb: style.bgmGainDb ?? a.bgmGainDb,
      duckRanges,
      duckingDb,
      duckAttackMs: a.duckAttackMs,
      duckReleaseMs: a.duckReleaseMs,
    });
  }

  return out;
}
