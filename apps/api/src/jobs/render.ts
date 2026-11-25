/**
 * 렌더 작업 — Project JSON의 클립 하나를 1080p MP4로 만든다.
 *
 * 번들은 한 번만 만들고 재사용한다. 매번 다시 만들면 렌더보다 번들링이 오래 걸린다.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { Project, ResolvedTimeline } from '@skycut/schema';
import { getTemplate } from '@skycut/templates';
import { resolve as resolveTimeline } from '@skycut/core';
import { enableSkycutResolution } from '../../../renderer/webpack-override.js';
import { DOWNLOAD_DIR, MEDIA_DIR, PROJECT_DIR, ROOT } from '../config.js';
import type { JobContext } from './queue.js';

export interface RenderInput {
  projectId: string;
  clipId: string;
  templateId?: string;
  titleIndex?: number;
}

const ENTRY = join(ROOT, 'apps', 'renderer', 'src', 'index.ts');
let serveUrlPromise: Promise<string> | null = null;

/** 번들을 한 번만 만든다. 동시에 여러 작업이 들어와도 하나만 만든다. */
function getServeUrl(): Promise<string> {
  if (!serveUrlPromise) {
    serveUrlPromise = bundle({
      entryPoint: ENTRY,
      publicDir: MEDIA_DIR,
      webpackOverride: enableSkycutResolution,
      onProgress: () => undefined,
    }).catch((err) => {
      serveUrlPromise = null; // 실패하면 다음 작업이 다시 해 보게 둔다
      throw err;
    });
  }
  return serveUrlPromise;
}

export async function runRender(ctx: JobContext): Promise<Record<string, unknown>> {
  const input = ctx.job.input as unknown as RenderInput;
  const projectPath = join(PROJECT_DIR, `${input.projectId}.json`);
  if (!existsSync(projectPath)) {
    throw { reason: 'not_found', message: '프로젝트를 찾을 수 없어요.' };
  }

  const project = Project.parse(JSON.parse(readFileSync(projectPath, 'utf8')));
  const clip = project.clips.find((c) => c.id === input.clipId);
  if (!clip) {
    throw { reason: 'not_found', message: `클립 ${input.clipId}을(를) 찾을 수 없어요.` };
  }

  const templateId = input.templateId ?? clip.appliedTemplateId;
  const chosen = input.titleIndex ?? clip.selectedTitleIndex;
  const timeline = ResolvedTimeline.parse(
    resolveTimeline({
      project,
      clip: { ...clip, selectedTitleIndex: chosen },
      template: getTemplate(templateId),
      mode: 'export',
    }),
  );

  ctx.report({ stage: 'bundle', label: '준비하는 중', pct: 0.05 });
  const serveUrl = await getServeUrl();
  if (ctx.signal.aborted) throw { reason: 'canceled', message: '취소했어요.' };

  const base = await selectComposition({ serveUrl, id: 'Clip' });
  const composition = {
    ...base,
    width: timeline.width,
    height: timeline.height,
    fps: timeline.fps,
    durationInFrames: timeline.durationInFrames,
    props: { timeline, assets: project.assets } as unknown as Record<string, unknown>,
    defaultProps: { timeline, assets: project.assets } as unknown as Record<string, unknown>,
  };

  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const name = `${input.projectId}--${clip.id}--${templateId}`;

  ctx.report({ stage: 'still', label: '썸네일 만드는 중', pct: 0.12 });
  await renderStill({
    composition,
    serveUrl,
    output: join(DOWNLOAD_DIR, `${name}.png`),
    frame: thumbnailFrame(timeline),
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: join(DOWNLOAD_DIR, `${name}.mp4`),
    onProgress: ({ progress }) => {
      ctx.report({ stage: 'render', label: '영상 만드는 중', pct: 0.15 + progress * 0.84 });
    },
  });

  return {
    file: `${name}.mp4`,
    thumbnail: `${name}.png`,
    downloadUrl: `/downloads/${name}.mp4`,
    thumbnailUrl: `/downloads/${name}.png`,
    durationMs: timeline.durationMs,
    templateId,
  };
}

/** 자막이 또렷하게 보이는 프레임을 고른다 (가장 긴 자막의 한가운데). */
function thumbnailFrame(timeline: ReturnType<typeof ResolvedTimeline.parse>): number {
  const fallback = Math.floor(timeline.durationInFrames * 0.35);
  const longest = timeline.captions.reduce<(typeof timeline.captions)[number] | null>(
    (best, c) => (!best || c.outEndMs - c.outStartMs > best.outEndMs - best.outStartMs ? c : best),
    null,
  );
  if (!longest) return fallback;
  const frame = Math.round(((longest.outStartMs + longest.outEndMs) / 2000) * timeline.fps);
  return Math.min(timeline.durationInFrames - 1, Math.max(0, frame));
}
