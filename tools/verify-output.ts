/**
 * 렌더 결과 MP4가 기대한 규격과 길이로 나왔는지 검사한다.
 *
 * M0 Gate: 출력 길이 = resolve()가 계산한 길이 ±1프레임, 1080×1920 / 30fps
 *   npx tsx tools/verify-output.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'out');

interface Sample {
  id: string;
  timeline: { width: number; height: number; fps: number; durationInFrames: number; durationMs: number };
}

const samples = JSON.parse(
  readFileSync(join(ROOT, 'apps', 'renderer', 'src', 'samples.generated.json'), 'utf8'),
) as Sample[];

function probe(file: string) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_frames,avg_frame_rate:format=duration',
    '-of', 'json',
    file,
  ]).toString();
  const j = JSON.parse(raw) as {
    streams: { width: number; height: number; nb_frames?: string; avg_frame_rate: string }[];
    format: { duration: string };
  };
  const s = j.streams[0]!;
  const [num, den] = s.avg_frame_rate.split('/').map(Number);
  return {
    width: s.width,
    height: s.height,
    frames: s.nb_frames ? Number(s.nb_frames) : NaN,
    fps: den ? num! / den : NaN,
    durationSec: Number(j.format.duration),
  };
}

let failed = 0;
for (const s of samples) {
  const file = join(OUT, `${s.id}.mp4`);
  if (!existsSync(file)) {
    failed++;
    console.error(`FAIL  ${s.id}: 파일이 없습니다. npm run render:all 을 먼저 실행하세요.`);
    continue;
  }
  const p = probe(file);
  const t = s.timeline;
  const problems: string[] = [];
  if (p.width !== t.width || p.height !== t.height) problems.push(`해상도 ${p.width}×${p.height} ≠ ${t.width}×${t.height}`);
  if (Math.abs(p.fps - t.fps) > 0.01) problems.push(`fps ${p.fps} ≠ ${t.fps}`);
  if (Number.isFinite(p.frames) && Math.abs(p.frames - t.durationInFrames) > 1) {
    problems.push(`프레임 수 ${p.frames} ≠ ${t.durationInFrames} (±1 허용)`);
  }
  const expectedSec = t.durationMs / 1000;
  if (Math.abs(p.durationSec - expectedSec) > 1 / t.fps + 0.02) {
    problems.push(`길이 ${p.durationSec.toFixed(3)}s ≠ ${expectedSec.toFixed(3)}s`);
  }

  if (problems.length) {
    failed++;
    console.error(`FAIL  ${s.id}\n      ${problems.join('\n      ')}`);
  } else {
    console.log(`  OK  ${s.id}  ${p.width}×${p.height} ${p.fps}fps ${p.frames}f ${p.durationSec.toFixed(2)}s`);
  }
}

console.log(`\n${samples.length - failed}/${samples.length} 통과`);
process.exit(failed ? 1 : 0);
