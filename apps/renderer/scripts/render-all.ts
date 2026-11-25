/**
 * 샘플 × 테마 2종을 MP4로 렌더링한다.
 *
 *   npm run render:all                 # 전부
 *   npm run render:all -- fx-video-ramen--a-black
 *   npm run render:all -- --still      # 썸네일(PNG)만
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { enableSkycutResolution } from '../webpack-override.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const ENTRY = join(here, '..', 'src', 'index.ts');
const OUT = join(ROOT, 'out');

const args = process.argv.slice(2);
const stillOnly = args.includes('--still');
const filters = args.filter((a) => !a.startsWith('--'));

async function main() {
  // 샘플 JSON을 항상 최신으로
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(here, 'build-samples.ts')], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  mkdirSync(OUT, { recursive: true });

  console.log('\n번들링...');
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    webpackOverride: enableSkycutResolution,
    onProgress: () => undefined,
  });

  const { default: samples } = (await import('../src/samples.generated.json', { with: { type: 'json' } })) as {
    default: { id: string; title: string }[];
  };

  const targets = samples.filter((s) => filters.length === 0 || filters.some((f) => s.id.includes(f)));
  if (targets.length === 0) {
    console.error('조건에 맞는 샘플이 없습니다:', filters.join(', '));
    process.exit(1);
  }

  for (const s of targets) {
    const composition = await selectComposition({ serveUrl, id: s.id });

    const stillPath = join(OUT, `${s.id}.png`);
    await renderStill({ composition, serveUrl, output: stillPath, frame: Math.floor(composition.durationInFrames * 0.35) });
    console.log(`  썸네일  ${stillPath}`);

    if (stillOnly) continue;

    const videoPath = join(OUT, `${s.id}.mp4`);
    let lastShown = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: videoPath,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastShown + 20) {
          lastShown = pct;
          process.stdout.write(`\r  렌더링  ${s.id} ${pct}%   `);
        }
      },
    });
    process.stdout.write(`\r  렌더링  ${videoPath}        \n`);
  }

  console.log(`\n완료: ${targets.length}개 → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
