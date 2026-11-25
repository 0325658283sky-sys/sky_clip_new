/** 템플릿이 Zod 스키마를 통과하는지 확인한다. */
import { TemplateSpec } from '@skycut/schema';
import { TEMPLATES } from '@skycut/templates';

let failed = 0;
for (const [id, t] of Object.entries(TEMPLATES)) {
  const r = TemplateSpec.safeParse(t);
  if (r.success) {
    console.log(`  OK  ${id}`);
  } else {
    failed++;
    console.error(`FAIL  ${id}`);
    for (const issue of r.error.issues.slice(0, 8)) {
      console.error(`      ${issue.path.join('.')}: ${issue.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
