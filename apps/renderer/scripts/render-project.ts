/**
 * 워커가 만든 Project JSON을 1080p MP4로 렌더링한다 (M2).
 *
 *   npm run render:project -- out/p.json
 *   npm run render:project -- out/p.json --clip c2 --template b-white
 *   npm run render:project -- out/p.json --still
 *
 * 에셋은 assetId로만 참조되므로, 미디어 저장소를 Remotion의 공개 폴더로
 * 넘겨 staticFile이 찾게 한다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { Project, ResolvedTimeline } from '@skycut/schema';
import { getTemplate, TEMPLATE_IDS } from '@skycut/templates';
import { resolve as resolveTimeline } from '@skycut/core';
import { enableSkycutResolution } from '../webpack-override.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const ENTRY = join(here, '..', 'src', 'index.ts');

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const projectArg = positional[0];

if (!projectArg) {
  console.error('사용법: npm run render:project -- <project.json> [--clip c1] [--template a-black] [--still]');
  process.exit(1);
}

const projectPath = resolvePath(projectArg);
if (!existsSync(projectPath)) {
  console.error(`파일을 찾을 수 없습니다: ${projectPath}`);
  process.exit(1);
}

const mediaDir = resolvePath(flag('media') ?? join(ROOT, 'out', 'media'));
const outDir = resolvePath(flag('out') ?? join(ROOT, 'out', 'shorts'));
const stillOnly = has('still');
const frameArg = flag('frame');
const onlyClip = flag('clip');
const templateOverride = flag('template');

if (templateOverride && !TEMPLATE_IDS.includes(templateOverride)) {
  console.error(`모르는 테마: ${templateOverride} (있는 것: ${TEMPLATE_IDS.join(', ')})`);
  process.exit(1);
}

/**
 * 썸네일로 쓸 프레임을 고른다.
 *
 * 그냥 35% 지점을 찍으면 자막이 막 나타나는 순간(페이드 중)에 걸려
 * 글자가 비어 보이는 일이 있다. 가장 긴 자막의 한가운데를 고른다.
 */
function thumbnailFrame(timeline: ReturnType<typeof ResolvedTimeline.parse>): number {
  const fallback = Math.floor(timeline.durationInFrames * 0.35);
  const longest = timeline.captions.reduce<(typeof timeline.captions)[number] | null>(
    (best, c) => (!best || c.outEndMs - c.outStartMs > best.outEndMs - best.outStartMs ? c : best),
    null,
  );
  if (!longest) return fallback;
  const midMs = (longest.outStartMs + longest.outEndMs) / 2;
  const frame = Math.round((midMs / 1000) * timeline.fps);
  return Math.min(timeline.durationInFrames - 1, Math.max(0, frame));
}

async function main() {
  const project = Project.parse(JSON.parse(readFileSync(projectPath, 'utf8')));
  const clips = onlyClip ? project.clips.filter((c) => c.id === onlyClip) : project.clips;

  if (clips.length === 0) {
    console.error(onlyClip ? `클립 ${onlyClip}을(를) 찾을 수 없습니다.` : '프로젝트에 클립이 없습니다.');
    process.exit(1);
  }

  // 샘플 JSON이 있어야 번들이 만들어진다 (범용 컴포지션의 기본값으로 쓰인다)
  execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(here, 'build-samples.ts')],
    { stdio: 'ignore', cwd: ROOT },
  );

  if (!existsSync(mediaDir)) {
    console.warn(`미디어 저장소가 없습니다: ${mediaDir}\n  영상 대신 자리 표시 그림이 그려집니다.`);
    mkdirSync(mediaDir, { recursive: true });
  }

  console.log('번들링...');
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: mediaDir, // assetId/variant 경로를 staticFile이 여기서 찾는다
    webpackOverride: enableSkycutResolution,
    onProgress: () => undefined,
  });

  const base = await selectComposition({ serveUrl, id: 'Clip' });
  mkdirSync(outDir, { recursive: true });
  const stem = basename(projectPath).replace(/\.json$/i, '');

  for (const clip of clips) {
    const templateId = templateOverride ?? clip.appliedTemplateId;
    const timeline = ResolvedTimeline.parse(
      resolveTimeline({ project, clip, template: getTemplate(templateId), mode: 'export' }),
    );
    const composition = {
      ...base,
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      durationInFrames: timeline.durationInFrames,
      props: { timeline, assets: project.assets } as unknown as Record<string, unknown>,
      defaultProps: { timeline, assets: project.assets } as unknown as Record<string, unknown>,
    };

    const name = `${stem}--${clip.id}--${templateId}`;
    const stillFrame = frameArg
      ? Math.min(timeline.durationInFrames - 1, Math.max(0, Number(frameArg)))
      : thumbnailFrame(timeline);
    await renderStill({ composition, serveUrl, output: join(outDir, `${name}.png`), frame: stillFrame });
    console.log(`  썸네일  ${join(outDir, `${name}.png`)}`);
    if (stillOnly) continue;

    let shown = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: join(outDir, `${name}.mp4`),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= shown + 20) {
          shown = pct;
          process.stdout.write(`\r  렌더링  ${name} ${pct}%   `);
        }
      },
    });
    process.stdout.write(`\r  렌더링  ${join(outDir, `${name}.mp4`)}        \n`);
  }

  console.log(`\n완료: ${clips.length}개 → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
