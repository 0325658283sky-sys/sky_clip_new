/**
 * Zod(단일 원천) → JSON Schema 생성.
 * 생성물은 커밋한다. Python 쪽은 이 파일에서 Pydantic을 만든다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Project, TemplateSpec, ResolvedTimeline } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'generated');
mkdirSync(outDir, { recursive: true });

const targets: Array<[string, z.ZodType, string]> = [
  ['project', Project, 'SkyCut Project'],
  ['template-spec', TemplateSpec, 'SkyCut TemplateSpec'],
  ['resolved-timeline', ResolvedTimeline, 'SkyCut ResolvedTimeline'],
];

for (const [name, schema, title] of targets) {
  const json = z.toJSONSchema(schema, { io: 'output', target: 'draft-2020-12' });
  const doc = { $schema: 'https://json-schema.org/draft/2020-12/schema', title, ...json };
  const file = join(outDir, `${name}.schema.json`);
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('wrote', file);
}
