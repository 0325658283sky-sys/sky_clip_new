/**
 * M4 종단 테스트 — 입력 → 진행 → 결과 → 다운로드.
 *
 * 오프라인 모드로 돌리므로 API 키가 없어도 된다. 품질이 아니라
 * **흐름이 끊기지 않는지**를 본다.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = process.cwd();
const SAMPLE_VIDEO = join(ROOT, 'e2e', 'fixtures', 'sample.mp4');
const BLOG_URL = `${process.env.E2E_BLOG_BASE ?? 'http://127.0.0.1:8732'}/post.html`;

/** 분석과 렌더는 오래 걸린다 */
const ANALYZE_TIMEOUT = 180_000;
const RENDER_TIMEOUT = 300_000;

test.describe('초심자 흐름', () => {
  test('영상 파일 → 쇼츠 → 1080p 다운로드', async ({ page }) => {
    test.skip(!existsSync(SAMPLE_VIDEO), 'e2e/fixtures/sample.mp4 가 없습니다 (npm run e2e:setup)');
    test.setTimeout(ANALYZE_TIMEOUT + RENDER_TIMEOUT);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '쇼츠 만들기' })).toBeVisible();

    await page.getByRole('button', { name: '영상 올리기' }).click();
    await page.locator('#file').setInputFiles(SAMPLE_VIDEO);
    await page.locator('#rights').check();

    await page.getByRole('button', { name: '쇼츠 만들기' }).click();

    // 진행 화면
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(page.getByRole('progressbar')).toBeVisible();

    // 결과 화면으로 자동 이동
    await page.waitForURL(/\/projects\//, { timeout: ANALYZE_TIMEOUT });
    await expect(page.getByRole('heading', { name: /쇼츠 \d+개를 만들었어요/ })).toBeVisible();

    // 미리보기가 뜬다
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000});

    // 테마를 바꿔도 화면이 유지된다
    await page.getByRole('button', { name: '게시물 화이트' }).first().click();
    await expect(page.getByRole('button', { name: '게시물 화이트' }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 다운로드
    const download = page.waitForEvent('download', { timeout: RENDER_TIMEOUT });
    await page.getByRole('button', { name: '1080p 다운로드' }).first().click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.mp4$/);
  });

  test('블로그 주소 → 나레이션 쇼츠', async ({ page }) => {
    test.skip(!process.env.E2E_BLOG_BASE, 'E2E_BLOG_BASE 가 없습니다 (npm run e2e:setup)');
    test.setTimeout(ANALYZE_TIMEOUT);

    await page.goto('/');
    await page.locator('#source').fill(BLOG_URL);
    await expect(page.getByText('블로그 글로 인식했어요', { exact: false })).toBeVisible();

    await page.locator('#rights').check();
    await page.getByRole('button', { name: '쇼츠 만들기' }).click();

    await page.waitForURL(/\/projects\//, { timeout: ANALYZE_TIMEOUT });
    await expect(page.getByRole('heading', { name: /쇼츠 \d+개를 만들었어요/ })).toBeVisible();
  });

  test('테마 교체가 100ms 안에 반영된다', async ({ page }) => {
    test.skip(!process.env.E2E_PROJECT_ID, 'E2E_PROJECT_ID 가 없습니다');

    await page.goto(`/projects/${process.env.E2E_PROJECT_ID}`);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30_000 });

    const worst = await page.evaluate(async () => {
      const buttons = [...document.querySelectorAll('button')].filter((b) =>
        /예능 블랙|게시물 화이트/.test(b.textContent ?? ''),
      );
      const times: number[] = [];
      for (let i = 0; i < 6; i++) {
        const target = buttons.find((b) => b.getAttribute('aria-pressed') !== 'true');
        if (!target) break;
        const started = performance.now();
        target.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
        );
        times.push(performance.now() - started);
      }
      return Math.max(...times);
    });

    expect(worst).toBeLessThan(100);
  });
});

test.describe('실패 처리', () => {
  test('없는 주소는 사유를 보여 주고 다시 시도할 수 있다', async ({ page }) => {
    test.setTimeout(ANALYZE_TIMEOUT);

    await page.goto('/');
    await page.locator('#source').fill('https://www.youtube.com/watch?v=AAAAAAAAAAA');
    await page.locator('#rights').check();
    await page.getByRole('button', { name: '쇼츠 만들기' }).click();

    await expect(page).toHaveURL(/\/jobs\//);
    await expect(page.getByRole('heading', { name: '만들지 못했어요' })).toBeVisible({
      timeout: ANALYZE_TIMEOUT,
    });
    // 다시 시도 버튼이나 "다시 시도해도 같은 결과" 안내 중 하나는 보여야 한다
    const retry = page.getByRole('button', { name: '다시 시도' });
    const permanent = page.getByText('다시 시도해도 같은 결과예요', { exact: false });
    await expect(retry.or(permanent)).toBeVisible();
  });

  test('권리 확인 전에는 시작할 수 없다', async ({ page }) => {
    await page.goto('/');
    await page.locator('#source').fill('https://youtu.be/dQw4w9WgXcQ');
    await expect(page.getByRole('button', { name: '쇼츠 만들기' })).toBeDisabled();
    await page.locator('#rights').check();
    await expect(page.getByRole('button', { name: '쇼츠 만들기' })).toBeEnabled();
  });
});
