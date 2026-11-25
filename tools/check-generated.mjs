/**
 * 생성물(JSON Schema)이 Zod 원천과 일치하는지 검사한다.
 * CI에서 실패하면 `npm run schema:json && npm run schema:python` 후 커밋.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const genDir = join(root, 'packages', 'schema', 'generated');

const backup = mkdtempSync(join(tmpdir(), 'skycut-schema-'));
cpSync(genDir, backup, { recursive: true });

try {
  execFileSync(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(root, 'packages', 'schema', 'scripts', 'emit-json-schema.ts')], { stdio: 'inherit', cwd: root });

  const stale = [];
  for (const f of readdirSync(backup)) {
    if (!f.endsWith('.schema.json')) continue;
    const before = readFileSync(join(backup, f), 'utf8');
    const after = readFileSync(join(genDir, f), 'utf8');
    if (before !== after) stale.push(f);
  }

  if (stale.length) {
    console.error('\n생성물이 Zod 원천과 다릅니다:', stale.join(', '));
    console.error('`npm run schema:json && npm run schema:python` 후 커밋하세요.');
    process.exit(1);
  }
  console.log('생성물이 최신입니다.');
} finally {
  rmSync(backup, { recursive: true, force: true });
}
