import { z } from 'zod';

/** 현재 스키마 버전. 구조를 바꾸면 올리고 migrations/ 에 변환기를 추가한다. */
export const SCHEMA_VERSION = 1;

/** 원본 영상 기준 밀리초. 출력(컷 반영) 시간은 절대 저장하지 않는다. */
export const Ms = z.int().min(0).describe('원본 기준 밀리초');

/** 0~1 정규화 값. 픽셀 금지 (ARCHITECTURE.md 규칙 3) */
export const Norm = z.number().min(0).max(1);

/** 0~1 정규화 사각형. 부모 프레임 기준. */
export const Rect = z.object({
  x: Norm,
  y: Norm,
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type Rect = z.infer<typeof Rect>;

export const Hex = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, '#rgb / #rrggbb / #rrggbbaa');

export const Id = z.string().min(1).max(128);

/** 에셋 해상도 변종. preview=480p 프록시, export=1080p 원본. */
export const AssetVariant = z.enum(['source', 'proxy', 'wav16k']);
export type AssetVariant = z.infer<typeof AssetVariant>;

/**
 * 실제 미디어가 없을 때 렌더러가 그릴 자리 표시 그림.
 * M0 샘플 전용이며, M2부터는 실제 파일이 들어온다.
 */
export const PlaceholderSpec = z.object({
  kind: z.enum(['talk_scene', 'landscape']),
  palette: z.array(Hex).min(2).max(8),
  label: z.string().max(80).optional(),
});
export type PlaceholderSpec = z.infer<typeof PlaceholderSpec>;

/** 경로가 아닌 ID로 참조한다 (ARCHITECTURE.md 규칙 4) */
export const Asset = z.object({
  id: Id,
  kind: z.enum(['video', 'image', 'audio']),
  /** variant → 스토리지 키. 렌더 모드에 따라 proxy/source를 고른다. */
  variants: z.partialRecord(AssetVariant, z.string().min(1)).default({}),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  durationMs: Ms.optional(),
  placeholder: PlaceholderSpec.optional(),
});
export type Asset = z.infer<typeof Asset>;

export const RenderMode = z.enum(['preview', 'export']);
export type RenderMode = z.infer<typeof RenderMode>;
