import type { TemplateSpec } from '@skycut/schema';
import { themeABlack } from './theme-a-black.js';
import { themeBWhite } from './theme-b-white.js';

export * from './safe-area.js';
export { themeABlack, themeBWhite };

export const TEMPLATES: Record<string, TemplateSpec> = {
  [themeABlack.id]: themeABlack,
  [themeBWhite.id]: themeBWhite,
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function getTemplate(id: string): TemplateSpec {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`템플릿을 찾을 수 없습니다: ${id} (있는 것: ${TEMPLATE_IDS.join(', ')})`);
  return t;
}
