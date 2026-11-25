import { z } from 'zod';
import { Asset, Hex, Id, Ms, Rect, SCHEMA_VERSION } from './primitives.js';

/* ────────────────── 분석 결과 (원본 단위) ────────────────── */

export const Word = z.object({
  id: Id,
  text: z.string().min(1),
  startMs: Ms,
  endMs: Ms,
  speakerId: z.string().max(32).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type Word = z.infer<typeof Word>;

export const Sentence = z.object({
  id: Id,
  startWordId: Id,
  endWordId: Id,
});

export const Transcript = z.object({
  words: z.array(Word),
  sentences: z.array(Sentence).default([]),
});
export type Transcript = z.infer<typeof Transcript>;

export const ArticleSection = z.object({
  heading: z.string().max(200).optional(),
  paragraphs: z.array(z.string()).default([]),
  imageAssetIds: z.array(Id).default([]),
});

export const Article = z.object({
  title: z.string().max(300),
  blogName: z.string().max(100).optional(),
  author: z.string().max(100).optional(),
  sections: z.array(ArticleSection).default([]),
});
export type Article = z.infer<typeof Article>;

/* ────────────────── 클립 콘텐츠 (불변) ────────────────── */

/** 제목은 2줄 고정. keywordSpans는 2번째 줄의 강조 구간(문자 인덱스). */
export const TitleCandidate = z.object({
  line1: z.string().max(40),
  line2: z.string().max(40),
  keywordSpan: z.object({ start: z.int().min(0), end: z.int().min(0) }).optional(),
});
export type TitleCandidate = z.infer<typeof TitleCandidate>;

/** 블로그 입력에서 한 장면 = 나레이션 한 덩어리 + 이미지(또는 텍스트 카드) */
export const Scene = z.object({
  id: Id,
  narration: z.string().min(1),
  imageAssetId: Id.optional(),
  textCard: z.string().max(60).optional(),
});
export type Scene = z.infer<typeof Scene>;

export const BottomCard = z.object({
  kind: z.enum(['summary', 'real_comment', 'question']),
  text: z.string().max(120),
  /** real_comment일 때만. 작성자 이름은 가린 형태로 저장한다. */
  authorMasked: z.string().max(40).optional(),
});

export const EffectMoment = z.object({
  /** video_excerpt: 기준 단어 / narrated_story: 기준 장면 */
  anchorWordId: Id.optional(),
  anchorSceneId: Id.optional(),
  text: z.string().max(12),
});

export const ClipScore = z.object({
  total: z.number().min(0).max(5),
  hook: z.number().min(0).max(5),
  standalone: z.number().min(0).max(5),
  ending: z.number().min(0).max(5),
  value: z.number().min(0).max(5),
});

export const Credit = z.object({
  channelName: z.string().max(100),
  videoTitle: z.string().max(200).optional(),
});

export const ClipContent = z.object({
  kind: z.enum(['video_excerpt', 'narrated_story']),
  /** video_excerpt 전용: 원본 대본에서의 구간 */
  range: z.object({ startWordId: Id, endWordId: Id }).optional(),
  /** narrated_story 전용 */
  scenes: z.array(Scene).default([]),
  titles: z.array(TitleCandidate).min(1).max(5),
  bottomCard: BottomCard.optional(),
  effectMoments: z.array(EffectMoment).default([]),
  /** 군더더기 말·무음 "후보". 실제 삭제 여부는 템플릿 규칙과 overrides가 정한다. */
  autoEdit: z.object({
    fillerWordIds: z.array(Id).default([]),
    silenceRangesMs: z.array(z.object({ startMs: Ms, endMs: Ms })).default([]),
  }).default({ fillerWordIds: [], silenceRangesMs: [] }),
  score: ClipScore,
  reason: z.string().max(300).default(''),
  credit: Credit.optional(),
});
export type ClipContent = z.infer<typeof ClipContent>;

/* ────────────────── 사용자 편집 diff ────────────────── */

/** 템플릿을 바꿔도 유지되는 편집 */
export const ContentOverrides = z.object({
  /** 사용자가 직접 자른 구간 (원본 기준 ms) */
  cuts: z.array(z.object({ startMs: Ms, endMs: Ms })).default([]),
  /** 자동 삭제 후보 중 사용자가 되살린 단어 */
  keepWordIds: z.array(Id).default([]),
  /** wordId → 수정한 자막 텍스트 */
  captionText: z.record(Id, z.string()).default({}),
  titleOverride: TitleCandidate.optional(),
  bottomCardText: z.string().max(120).optional(),
  extraEffectMoments: z.array(EffectMoment).default([]),
  mediaCrop: Rect.optional(),
});

/** 템플릿을 바꾸면 초기화되는 편집 */
export const StyleOverrides = z.object({
  titleColor: Hex.optional(),
  titleLine2Color: Hex.optional(),
  captionColor: Hex.optional(),
  captionFontScale: z.number().min(0.5).max(2).optional(),
  backgroundColor: Hex.optional(),
  bgmGainDb: z.number().min(-60).max(6).optional(),
  originalGainDb: z.number().min(-60).max(6).optional(),
  ttsGainDb: z.number().min(-60).max(6).optional(),
  duckingDb: z.number().min(-40).max(0).optional(),
});

export const ClipOverrides = z.object({
  content: ContentOverrides.default({
    cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [],
  }),
  style: StyleOverrides.default({}),
  /** 템플릿 교체 시 style을 유지할지 (기본: 초기화) */
  keepStyleOnTemplateChange: z.boolean().default(false),
});
export type ClipOverrides = z.infer<typeof ClipOverrides>;

export const EMPTY_OVERRIDES: ClipOverrides = {
  content: { cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [] },
  style: {},
  keepStyleOnTemplateChange: false,
};

/* ────────────────── 생성 에셋 (TTS 등) ────────────────── */

export const WordTiming = z.object({ text: z.string(), startMs: Ms, endMs: Ms });

export const GeneratedAsset = z.object({
  kind: z.literal('tts'),
  assetId: Id,
  /** hash(대본, 성우, 속도, 모델) — 같으면 재생성하지 않는다 */
  cacheKey: z.string().min(1).max(128),
  sceneId: Id.optional(),
  /** TTS 음성 자체의 0 기준 타이밍 */
  wordTimings: z.array(WordTiming).default([]),
  durationMs: Ms,
});
export type GeneratedAsset = z.infer<typeof GeneratedAsset>;

/* ────────────────── 클립 / 프로젝트 ────────────────── */

export const Clip = z.object({
  id: Id,
  content: ClipContent,
  appliedTemplateId: Id,
  selectedTitleIndex: z.int().min(0).default(0),
  overrides: ClipOverrides.default(EMPTY_OVERRIDES),
  generated: z.array(GeneratedAsset).default([]),
  /** narrated_story 전용: 장면 길이의 기준이 되는 총 길이 */
  narrationDurationMs: Ms.optional(),
});
export type Clip = z.infer<typeof Clip>;

export const ProjectInput = z.object({
  kind: z.enum(['youtube', 'upload', 'blog']),
  url: z.string().max(2000).optional(),
  rightsAttested: z.boolean(),
  attestedAt: z.string().max(40).optional(),
});

export const Project = z.object({
  schemaVersion: z.int().min(1).default(SCHEMA_VERSION),
  id: Id,
  createdAt: z.string().max(40),
  input: ProjectInput,
  /** 영상 입력일 때의 원본 */
  sourceAssetId: Id.optional(),
  assets: z.record(Id, Asset).default({}),
  transcript: Transcript.optional(),
  article: Article.optional(),
  clips: z.array(Clip).default([]),
  /** 재현성을 위해 사용한 프롬프트·모델 버전 기록 */
  provenance: z.object({
    llmModel: z.string().max(80).optional(),
    promptVersion: z.string().max(40).optional(),
    sttEngine: z.string().max(40).optional(),
    ttsProvider: z.string().max(40).optional(),
  }).default({}),
});
export type Project = z.infer<typeof Project>;
