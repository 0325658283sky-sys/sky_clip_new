/**
 * fixtures × 템플릿 2종 → Remotion이 읽을 샘플 모음.
 *
 * 컴포넌트는 브라우저에서 돌아 파일을 읽을 수 없으므로 JSON으로 구워 둔다.
 *   npx tsx apps/renderer/scripts/build-samples.ts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, ResolvedTimeline, type Asset } from '@skycut/schema';
import { getTemplate, TEMPLATE_IDS } from '@skycut/templates';
import { resolve as resolveTimeline } from '@skycut/core';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const FIXTURES = join(ROOT, 'fixtures');
const OUT = join(here, '..', 'src', 'samples.generated.json');

export interface Sample {
  id: string;
  projectId: string;
  templateId: string;
  title: string;
  timeline: unknown;
  assets: Record<string, Asset>;
}

const samples: Sample[] = [];

for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()) {
  const project = Project.parse(JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')));
  const clip = project.clips[0];
  if (!clip) continue;

  for (const templateId of TEMPLATE_IDS) {
    const timeline = ResolvedTimeline.parse(
      resolveTimeline({ project, clip, template: getTemplate(templateId), mode: 'export' }),
    );
    const t = clip.content.titles[clip.selectedTitleIndex] ?? clip.content.titles[0]!;
    samples.push({
      id: `${project.id}--${templateId}`,
      projectId: project.id,
      templateId,
      title: `${t.line1} ${t.line2}`.trim(),
      timeline,
      assets: project.assets,
    });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(samples, null, 2) + '\n', 'utf8');
console.log(`샘플 ${samples.length}개 → ${OUT}`);
for (const s of samples) {
  const tl = s.timeline as { durationMs: number; durationInFrames: number };
  console.log(`  ${s.id.padEnd(30)} ${(tl.durationMs / 1000).toFixed(2)}s / ${tl.durationInFrames}f`);
}
