/**
 * 임시 파일 정리.
 *
 * 업로드 원본과 완성된 MP4는 쌓이면 디스크를 먹는다. 에셋 저장소는
 * 같은 영상을 다시 넣을 때 재사용하므로 더 오래 둔다.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DOWNLOAD_DIR, RETENTION_HOURS, UPLOAD_DIR } from './config.js';
import type { JobStore } from './jobs/store.js';

const HOUR = 60 * 60 * 1000;

export interface CleanupReport {
  uploads: number;
  downloads: number;
  jobs: number;
}

export function cleanupOnce(store: JobStore, retentionHours = RETENTION_HOURS): CleanupReport {
  const cutoff = Date.now() - retentionHours * HOUR;
  return {
    uploads: removeOlderThan(UPLOAD_DIR, cutoff),
    downloads: removeOlderThan(DOWNLOAD_DIR, cutoff),
    jobs: store.prune(retentionHours * HOUR),
  };
}

function removeOlderThan(dir: string, cutoff: number): number {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (statSync(path).mtimeMs > cutoff) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch {
      // 다른 작업이 쓰는 중일 수 있다. 다음 차례에 지운다.
    }
  }
  return removed;
}

export function startCleanupSchedule(store: JobStore, everyHours = 6): () => void {
  const timer = setInterval(() => {
    const report = cleanupOnce(store);
    if (report.uploads || report.downloads || report.jobs) {
      console.log(
        `정리: 업로드 ${report.uploads}개 · 결과물 ${report.downloads}개 · 작업기록 ${report.jobs}개`,
      );
    }
  }, everyHours * HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
