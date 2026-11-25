/**
 * M0 Gate 검증:
 *  (a) 템플릿 교체 시 content 범위 유지 / style 범위 초기화
 *  (b) 컷 삭제 시 자막·효과 재배치·클리핑
 *  (c) preview / export에서 정규화 좌표 동일
 *  (d) 같은 입력 → 같은 출력 (결정성)
 *  (e) 군더더기 말 자동 삭제 및 개별 복구
 *  (f) 안전 영역 준수
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project, ResolvedTimeline, type Clip } from '@skycut/schema';
import { getTemplate, SAFE, TEMPLATES } from '@skycut/templates';
import { overridesForTemplateChange, resolve } from '../src/resolve.js';

const FIXTURES = join(process.cwd(), 'fixtures');

function load(name: string) {
  return Project.parse(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')));
}

const ramen = load('fx-video-ramen');
const variety = load('fx-video-variety');
const walk = load('fx-blog-walk');
const tip = load('fx-blog-tip');

const ALL = [
  ['fx-video-ramen', ramen],
  ['fx-video-variety', variety],
  ['fx-blog-walk', walk],
  ['fx-blog-tip', tip],
] as const;

describe('샘플 × 템플릿 조합이 모두 유효한 타임라인을 만든다', () => {
  for (const [name, project] of ALL) {
    for (const templateId of Object.keys(TEMPLATES)) {
      it(`${name} × ${templateId}`, () => {
        const clip = project.clips[0]!;
        const t = resolve({ project, clip, template: getTemplate(templateId), mode: 'export' });
        expect(ResolvedTimeline.safeParse(t).success).toBe(true);
        expect(t.durationMs).toBeGreaterThan(0);
        expect(t.captions.length).toBeGreaterThan(0);
        expect(t.segments.length).toBeGreaterThan(0);
      });
    }
  }
});

describe('(a) 템플릿 교체', () => {
  const clip = structuredClone(ramen.clips[0]!) as Clip;
  clip.overrides.content.cuts = [{ startMs: 126_000, endMs: 127_000 }];
  clip.overrides.content.captionText = { w3: '고친자막' };
  clip.overrides.style.titleColor = '#ff0000';

  it('content 편집은 템플릿을 바꿔도 유지된다', () => {
    const next = overridesForTemplateChange(clip.overrides);
    expect(next.content.cuts).toEqual(clip.overrides.content.cuts);
    expect(next.content.captionText).toEqual({ w3: '고친자막' });
  });

  it('style 편집은 기본적으로 초기화된다', () => {
    expect(overridesForTemplateChange(clip.overrides).style).toEqual({});
  });

  it('keepStyleOnTemplateChange가 켜져 있으면 style도 유지된다', () => {
    const kept = overridesForTemplateChange({ ...clip.overrides, keepStyleOnTemplateChange: true });
    expect(kept.style.titleColor).toBe('#ff0000');
  });

  it('템플릿을 바꾸면 길이는 같고 디자인만 바뀐다', () => {
    const a = resolve({ project: ramen, clip, template: getTemplate('a-black'), mode: 'export' });
    const b = resolve({
      project: ramen,
      clip: { ...clip, overrides: overridesForTemplateChange(clip.overrides) },
      template: getTemplate('b-white'),
      mode: 'export',
    });
    expect(b.durationMs).toBe(a.durationMs);
    expect(b.captions.length).toBe(a.captions.length);
    expect(a.background).not.toEqual(b.background);
    // A는 효과 글자를 쓰고 B는 쓰지 않는다
    expect(a.overlays.some((o) => o.kind === 'effect_text')).toBe(true);
    expect(b.overlays.some((o) => o.kind === 'effect_text')).toBe(false);
    // B만 프로필 헤더가 있다
    expect(b.overlays.some((o) => o.kind === 'profile_header')).toBe(true);
    expect(a.overlays.some((o) => o.kind === 'profile_header')).toBe(false);
  });
});

describe('(b) 컷 삭제 시 자막·효과 재배치', () => {
  const template = getTemplate('a-black');
  const base = resolve({ project: ramen, clip: ramen.clips[0]!, template, mode: 'export' });

  const clip = structuredClone(ramen.clips[0]!) as Clip;
  const words = ramen.transcript!.words;
  const cutFrom = words[5]!.startMs;
  const cutTo = words[8]!.endMs;
  clip.overrides.content.cuts = [{ startMs: cutFrom, endMs: cutTo }];
  const cut = resolve({ project: ramen, clip, template, mode: 'export' });

  it('길이가 삭제한 만큼 줄어든다', () => {
    expect(cut.durationMs).toBe(base.durationMs - (cutTo - cutFrom));
  });

  it('삭제 구간 안의 자막은 사라진다', () => {
    expect(cut.captions.length).toBeLessThan(base.captions.length);
  });

  it('남은 자막은 겹치지 않고 길이 안에 있다', () => {
    for (let i = 0; i < cut.captions.length; i++) {
      const c = cut.captions[i]!;
      expect(c.outEndMs).toBeGreaterThan(c.outStartMs);
      expect(c.outEndMs).toBeLessThanOrEqual(cut.durationMs + 1);
      const next = cut.captions[i + 1];
      if (next) expect(c.outEndMs).toBeLessThanOrEqual(next.outStartMs);
    }
  });

  it('미디어 구간도 둘로 나뉜다', () => {
    expect(cut.segments.length).toBe(2);
    expect(cut.segments[1]!.sourceStartMs).toBe(cutTo);
  });
});

describe('(c) preview와 export의 정규화 좌표가 같다', () => {
  for (const templateId of Object.keys(TEMPLATES)) {
    it(templateId, () => {
      const clip = ramen.clips[0]!;
      const template = getTemplate(templateId);
      const p = resolve({ project: ramen, clip, template, mode: 'preview' });
      const e = resolve({ project: ramen, clip, template, mode: 'export' });

      expect(p.mediaRect).toEqual(e.mediaRect);
      expect(p.title?.rect).toEqual(e.title?.rect);
      expect(p.captionLayout).toEqual(e.captionLayout);
      expect(p.durationMs).toBe(e.durationMs);
      expect(p.durationInFrames).toBe(e.durationInFrames);
      // 해상도와 에셋 변종만 다르다
      expect(p.width).toBeLessThan(e.width);
      expect(p.width / p.height).toBeCloseTo(e.width / e.height, 5);
      expect(p.segments[0]!.variant).toBe('proxy');
      expect(e.segments[0]!.variant).toBe('source');
    });
  }
});

describe('(d) 결정성', () => {
  it('같은 입력을 두 번 넣으면 완전히 같은 결과', () => {
    for (const [, project] of ALL) {
      for (const templateId of Object.keys(TEMPLATES)) {
        const args = { project, clip: project.clips[0]!, template: getTemplate(templateId), mode: 'export' as const };
        expect(JSON.stringify(resolve(args))).toBe(JSON.stringify(resolve(args)));
      }
    }
  });
});

describe('(e) 군더더기 말 자동 삭제', () => {
  const template = getTemplate('a-black');
  const clip = variety.clips[0]!;

  it('템플릿이 켜져 있으면 "어", "음"이 잘린다', () => {
    const on = resolve({ project: variety, clip, template, mode: 'export' });
    const off = resolve({
      project: variety,
      clip,
      template: { ...template, autoEdit: { ...template.autoEdit, removeFillers: false } },
      mode: 'export',
    });
    expect(on.durationMs).toBeLessThan(off.durationMs);
    expect(on.captions.map((c) => c.spans.map((s) => s.text).join('')).join(' ')).not.toMatch(/(^|\s)어(\s|$)/);
  });

  it('되살린 단어는 다시 들어간다', () => {
    const fillerId = clip.content.autoEdit.fillerWordIds[0]!;
    const restored = structuredClone(clip) as Clip;
    restored.overrides.content.keepWordIds = [fillerId];
    const on = resolve({ project: variety, clip, template, mode: 'export' });
    const back = resolve({ project: variety, clip: restored, template, mode: 'export' });
    expect(back.durationMs).toBeGreaterThan(on.durationMs);
  });

  it('자동 삭제 결과가 저장 데이터에 남지 않는다', () => {
    // clip.content는 후보만 들고 있고 cuts는 비어 있어야 한다
    expect(clip.overrides.content.cuts).toEqual([]);
    expect(clip.content.autoEdit.fillerWordIds.length).toBeGreaterThan(0);
  });
});

describe('(f) 모든 글자가 안전 영역 안에 있다', () => {
  for (const [name, project] of ALL) {
    for (const templateId of Object.keys(TEMPLATES)) {
      it(`${name} × ${templateId}`, () => {
        const t = resolve({ project, clip: project.clips[0]!, template: getTemplate(templateId), mode: 'export' });
        const boxes: { label: string; y: number; h: number; x: number; w: number }[] = [];
        if (t.title) boxes.push({ label: 'title', ...t.title.rect });
        for (const o of t.overlays) {
          if (o.kind === 'effect_text') continue; // 미디어 위에 겹치는 효과는 예외
          boxes.push({ label: o.kind, ...o.rect });
        }
        for (const b of boxes) {
          expect.soft(b.y, `${b.label} 상단`).toBeGreaterThanOrEqual(SAFE.top);
          expect.soft(b.y + b.h, `${b.label} 하단`).toBeLessThanOrEqual(SAFE.bottom);
          expect.soft(b.x + b.w, `${b.label} 오른쪽`).toBeLessThanOrEqual(1);
        }
      });
    }
  }
});

describe('오디오', () => {
  it('블로그 입력은 TTS 트랙을 만든다', () => {
    const t = resolve({ project: walk, clip: walk.clips[0]!, template: getTemplate('b-white'), mode: 'export' });
    expect(t.audio.filter((a) => a.kind === 'tts').length).toBe(walk.clips[0]!.content.scenes.length);
  });

  it('영상 입력은 원본 오디오 트랙을 만든다', () => {
    const t = resolve({ project: ramen, clip: ramen.clips[0]!, template: getTemplate('a-black'), mode: 'export' });
    expect(t.audio.some((a) => a.kind === 'original')).toBe(true);
  });
});

describe('이미지가 없는 장면', () => {
  it('텍스트 카드로 대체된다', () => {
    const t = resolve({ project: tip, clip: tip.clips[0]!, template: getTemplate('b-white'), mode: 'export' });
    const cards = t.segments.filter((s) => s.textCard);
    expect(cards.length).toBe(2);
    expect(cards[0]!.assetId).toBeUndefined();
  });
});
