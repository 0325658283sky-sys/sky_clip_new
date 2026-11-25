/**
 * M0 Gate: 미리보기(프록시 해상도)와 최종 렌더(1080p)가 같은 그림인지 검사.
 *
 * 같은 Remotion 컴포넌트를 쓰므로 해상도만 다르다. 프리뷰 프레임을 1080p로
 * 키운 뒤 SSIM으로 비교한다. 기준: 평균 SSIM ≥ 0.98
 *
 *   npx tsx tools/compare-preview-export.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { Project, ResolvedTimeline } from '@skycut/schema';
import { getTemplate, TEMPLATE_IDS } from '@skycut/templates';
import { resolve as resolveTimeline } from '@skycut/core';
import { enableSkycutResolution } from '../apps/renderer/webpack-override.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const ENTRY = join(ROOT, 'apps', 'renderer', 'src', 'index.ts');
const OUT = join(ROOT, 'out', 'compare');

const SSIM_THRESHOLD = 0.98;
/** 각 샘플에서 비교할 프레임 수 */
const SAMPLE_FRAMES = 5;

mkdirSync(OUT, { recursive: true });

/** PNG → 256×256 그레이스케일 픽셀. 새 의존성 없이 FFmpeg로 디코딩한다. */
function readGray(path: string, side = 256): Float64Array {
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-vf', `scale=${side}:${side}`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const out = new Float64Array(side * side);
  for (let i = 0; i < out.length; i++) out[i] = buf[i] ?? 0;
  return out;
}

function ssim(a: Float64Array, b: Float64Array): number {
  // 전역 SSIM (8×8 윈도우 평균)
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let sum = 0;
  let n = 0;
  const WIN = 8;
  const side = Math.floor(Math.sqrt(a.length));
  for (let wy = 0; wy + WIN <= side; wy += WIN) {
    for (let wx = 0; wx + WIN <= side; wx += WIN) {
      let ma = 0, mb = 0;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        const i = (wy + y) * side + wx + x;
        ma += a[i]!; mb += b[i]!;
      }
      const cnt = WIN * WIN;
      ma /= cnt; mb /= cnt;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        const i = (wy + y) * side + wx + x;
        const da = a[i]! - ma, db = b[i]! - mb;
        va += da * da; vb += db * db; cov += da * db;
      }
      va /= cnt - 1; vb /= cnt - 1; cov /= cnt - 1;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? sum / n : 1;
}

async function main() {
  console.log('번들링...');
  const serveUrl = await bundle({ entryPoint: ENTRY, webpackOverride: enableSkycutResolution, onProgress: () => undefined });

  const fixtures = readdirSync(join(ROOT, 'fixtures')).filter((f) => f.endsWith('.json')).sort();
  const results: { id: string; frame: number; ssim: number }[] = [];

  for (const file of fixtures) {
    const project = Project.parse(JSON.parse(readFileSync(join(ROOT, 'fixtures', file), 'utf8')));
    const clip = project.clips[0];
    if (!clip) continue;

    for (const templateId of TEMPLATE_IDS) {
      const id = `${project.id}--${templateId}`;
      const exportTl = ResolvedTimeline.parse(resolveTimeline({ project, clip, template: getTemplate(templateId), mode: 'export' }));
      const previewTl = ResolvedTimeline.parse(resolveTimeline({ project, clip, template: getTemplate(templateId), mode: 'preview' }));

      const composition = await selectComposition({ serveUrl, id });

      for (let k = 1; k <= SAMPLE_FRAMES; k++) {
        const frame = Math.floor((exportTl.durationInFrames * k) / (SAMPLE_FRAMES + 1));
        const exPath = join(OUT, `${id}-f${frame}-export.png`);
        const prPath = join(OUT, `${id}-f${frame}-preview.png`);

        // renderStill은 composition.props를 그린다. width/height와 props를 함께 바꿔야 한다.
        const withProps = (tl: typeof exportTl) => ({
          ...composition,
          width: tl.width,
          height: tl.height,
          props: { timeline: tl, assets: project.assets } as unknown as Record<string, unknown>,
          defaultProps: { timeline: tl, assets: project.assets } as unknown as Record<string, unknown>,
        });

        await renderStill({ composition: withProps(exportTl), serveUrl, output: exPath, frame });
        await renderStill({ composition: withProps(previewTl), serveUrl, output: prPath, frame });

        const ex = readGray(exPath);
        const pr = readGray(prPath);
        const score = ssim(ex, pr);
        results.push({ id, frame, ssim: score });
        const mark = score >= SSIM_THRESHOLD ? ' OK ' : 'FAIL';
        console.log(`  ${mark} ${id} f${frame}  SSIM ${score.toFixed(4)}`);
      }
    }
  }

  const avg = results.reduce((s, r) => s + r.ssim, 0) / results.length;
  const worst = results.reduce((m, r) => (r.ssim < m.ssim ? r : m), results[0]!);
  console.log(`\n프레임 ${results.length}개 · 평균 SSIM ${avg.toFixed(4)} · 최저 ${worst.ssim.toFixed(4)} (${worst.id} f${worst.frame})`);
  console.log(worst.ssim >= SSIM_THRESHOLD ? '통과' : `실패: 기준 ${SSIM_THRESHOLD}`);
  process.exit(worst.ssim >= SSIM_THRESHOLD ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
