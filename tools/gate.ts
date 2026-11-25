/**
 * M0 완료 검증을 한 번에 돌린다.
 *   npm run gate
 *
 * 사람이 직접 봐야 하는 항목(실제 휴대폰 쇼츠 화면 확인)은 마지막에 안내만 한다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface Step {
  label: string;
  run: () => number;
  skipIf?: () => string | null;
}

function node(args: string[]): number {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  return r.status ?? 1;
}

function npmRun(script: string): number {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '--silent', script], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
}

const steps: Step[] = [
  { label: '스키마 생성물이 최신인가', run: () => npmRun('schema:check') },
  { label: '샘플 Project가 스키마를 통과하는가', run: () => node([tsx, join(ROOT, 'tools', 'make-fixtures.ts')]) },
  { label: '템플릿 2종이 스키마를 통과하는가', run: () => node([tsx, join(ROOT, 'tools', 'validate-templates.ts')]) },
  { label: 'core 단위 테스트 (Gate a~f)', run: () => npmRun('test') },
  { label: 'TS ↔ Python 왕복', run: () => node([tsx, join(ROOT, 'tools', 'roundtrip-check.ts')]) },
  {
    label: '렌더 결과 규격·길이',
    skipIf: () => (existsSync(join(ROOT, 'out', 'fx-video-ramen--a-black.mp4')) ? null : 'npm run render:all 을 먼저 실행하세요'),
    run: () => node([tsx, join(ROOT, 'tools', 'verify-output.ts')]),
  },
];

let failed = 0;
for (const s of steps) {
  const skip = s.skipIf?.();
  if (skip) {
    console.log(`\n── SKIP  ${s.label}  (${skip})`);
    continue;
  }
  console.log(`\n── ${s.label}`);
  const code = s.run();
  if (code !== 0) {
    failed++;
    console.error(`   실패 (exit ${code})`);
  }
}

console.log('\n' + '─'.repeat(60));
if (failed) {
  console.error(`${failed}개 항목 실패`);
} else {
  console.log('자동 검증 통과.');
}
console.log(`
사람이 직접 확인해야 하는 M0 Gate:
  1. out/*.mp4 를 휴대폰으로 옮겨 유튜브 쇼츠에 비공개 업로드하고
     제목·자막·하단 카드가 앱 버튼에 가려지지 않는지 본다
  2. 하단 요약 카드를 더 올릴지, 가운데 미디어를 줄일지 정한다
  3. 테마 B(흰 배경)에서 앱의 흰 글자(채널명·설명)가 읽히는지 본다
  4. npx tsx tools/compare-preview-export.ts 로 미리보기 일치(SSIM) 확인
`);
process.exit(failed ? 1 : 0);
