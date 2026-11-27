import type { TemplateSpec } from '@skycut/schema';
import { themeABlack } from './theme-a-black.js';
import { themeBWhite } from './theme-b-white.js';
import { themeCYellow } from './theme-c-yellow.js';

export * from './safe-area.js';
export { themeABlack, themeBWhite, themeCYellow };

export const TEMPLATES: Record<string, TemplateSpec> = {
  [themeABlack.id]: themeABlack,
  [themeBWhite.id]: themeBWhite,
  [themeCYellow.id]: themeCYellow,
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function getTemplate(id: string): TemplateSpec {
  const t = TEMPLATES[id];
  if (!t) throw new Error(`템플릿을 찾을 수 없습니다: ${id} (있는 것: ${TEMPLATE_IDS.join(', ')})`);
  return t;
}
