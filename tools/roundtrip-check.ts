/**
 * M0 Gate: TS → JSON → Python → JSON → TS 왕복 결과가 완전히 같은지 검사.
 *
 *   npx tsx tools/roundtrip-check.ts
 *
 * 1) 템플릿 2종과 샘플 타임라인을 .roundtrip/*-in 에 쓴다
 * 2) Python(Pydantic)으로 읽고 다시 쓴다
 * 3) 결과를 TS 스키마로 다시 파싱하고 원본과 비교한다
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Project, ResolvedTimeline, TemplateSpec } from '@skycut/schema';
import { getTemplate, TEMPLATE_IDS } from '@skycut/templates';
import { resolve as resolveTimeline } from '@skycut/core';

const ROOT = process.cwd();
const RT = join(ROOT, '.roundtrip');
const FIXTURES = join(ROOT, 'fixtures');

const python = process.platform === 'win32'
  ? join(ROOT, '.venv', 'Scripts', 'python.exe')
  : join(ROOT, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(`Python 가상환경이 없습니다: ${python}`);
  console.error('python -m venv .venv && .venv/Scripts/python -m pip install pydantic datamodel-code-generator');
  process.exit(1);
}

/* 1) 입력 준비 */
const tplIn = join(RT, 'templates-in');
const tlIn = join(RT, 'timelines-in');
mkdirSync(tplIn, { recursive: true });
mkdirSync(tlIn, { recursive: true });

for (const id of TEMPLATE_IDS) {
  writeFileSync(join(tplIn, `${id}.json`), JSON.stringify(TemplateSpec.parse(getTemplate(id)), null, 2) + '\n', 'utf8');
}

const fixtureFiles = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
for (const f of fixtureFiles) {
  const project = Project.parse(JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')));
  for (const id of TEMPLATE_IDS) {
    const timeline = resolveTimeline({ project, clip: project.clips[0]!, template: getTemplate(id), mode: 'export' });
    const name = `${f.replace(/\.json$/, '')}--${id}.json`;
    writeFileSync(join(tlIn, name), JSON.stringify(ResolvedTimeline.parse(timeline), null, 2) + '\n', 'utf8');
  }
}

/* 2) Python 왕복 */
execFileSync(python, [join(ROOT, 'tools', 'roundtrip.py')], { stdio: 'inherit', cwd: ROOT });

/* 3) 비교 */
type Check = { label: string; original: unknown; after: string; schema: typeof Project | typeof TemplateSpec | typeof ResolvedTimeline };

const checks: Check[] = [];
for (const f of fixtureFiles) {
  checks.push({
    label: `Project ${f}`,
    original: JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')),
    after: join(RT, 'fixtures', f),
    schema: Project,
  });
}
for (const f of readdirSync(tplIn)) {
  checks.push({
    label: `TemplateSpec ${f}`,
    original: JSON.parse(readFileSync(join(tplIn, f), 'utf8')),
    after: join(RT, 'templates', f),
    schema: TemplateSpec,
  });
}
for (const f of readdirSync(tlIn)) {
  checks.push({
    label: `ResolvedTimeline ${f}`,
    original: JSON.parse(readFileSync(join(tlIn, f), 'utf8')),
    after: join(RT, 'timelines', f),
    schema: ResolvedTimeline,
  });
}

/** 키 순서 차이는 무시하고 값만 비교한다. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined) continue;
      out[k] = canonical(o[k]);
    }
    return out;
  }
  return v;
}

let failed = 0;
for (const c of checks) {
  if (!existsSync(c.after)) {
    failed++;
    console.error(`FAIL  ${c.label}: Python 결과 파일이 없습니다 (${c.after})`);
    continue;
  }
  const back = JSON.parse(readFileSync(c.after, 'utf8'));
  const reparsed = c.schema.safeParse(back);
  if (!reparsed.success) {
    failed++;
    console.error(`FAIL  ${c.label}: Python 결과가 TS 스키마를 통과하지 못했습니다`);
    for (const i of reparsed.error.issues.slice(0, 5)) console.error(`      ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  const a = JSON.stringify(canonical(c.original));
  const b = JSON.stringify(canonical(reparsed.data));
  if (a !== b) {
    failed++;
    console.error(`FAIL  ${c.label}: 왕복 결과가 다릅니다`);
    const la = JSON.parse(a) as Record<string, unknown>;
    const lb = JSON.parse(b) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(la), ...Object.keys(lb)])) {
      const sa = JSON.stringify(la[k]);
      const sb = JSON.stringify(lb[k]);
      if (sa !== sb) console.error(`      ${k}:\n        TS  ${sa?.slice(0, 180)}\n        PY  ${sb?.slice(0, 180)}`);
    }
    continue;
  }
  console.log(`  OK  ${c.label}`);
}

console.log(`\n${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
