/**
 * 작업 상태를 디스크에 남긴다.
 *
 * 메모리에 들고 쓰다가 바뀔 때만 파일로 쓴다. 진행률은 자주 바뀌므로
 * 파일 쓰기를 조금 미룬다 — 어차피 끊기면 복구 대상이다.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from './types.js';

const FLUSH_DELAY_MS = 300;

export class JobStore {
  private readonly cache = new Map<string, Job>();
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  private load(): void {
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Job;
        this.cache.set(job.id, job);
      } catch {
        // 깨진 파일은 무시한다. 작업 하나를 잃을 뿐 서버는 떠야 한다.
      }
    }
  }

  get(id: string): Job | null {
    return this.cache.get(id) ?? null;
  }

  list(): Job[] {
    return [...this.cache.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  save(job: Job): Job {
    this.cache.set(job.id, job);
    this.schedule(job.id);
    return job;
  }

  update(id: string, patch: Partial<Job>): Job | null {
    const current = this.cache.get(id);
    if (!current) return null;
    const next: Job = { ...current, ...patch };
    // undefined로 지우라는 뜻이면 실제로 지운다
    for (const key of Object.keys(patch) as (keyof Job)[]) {
      if (patch[key] === undefined) delete next[key];
    }
    this.cache.set(id, next);
    this.schedule(id, next.state !== 'running');
    return next;
  }

  remove(id: string): void {
    this.cache.delete(id);
    rmSync(join(this.dir, `${id}.json`), { force: true });
  }

  /** 오래된 기록 정리 */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const job of this.list()) {
      if (job.state === 'running' || job.state === 'queued') continue;
      if (Date.parse(job.finishedAt ?? job.createdAt) > cutoff) continue;
      this.remove(job.id);
      removed++;
    }
    return removed;
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const id of this.pending) this.write(id);
    this.pending.clear();
  }

  private schedule(id: string, immediate = false): void {
    this.pending.add(id);
    if (immediate) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  private write(id: string): void {
    const job = this.cache.get(id);
    if (!job) return;
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(job, null, 2), 'utf8');
  }
}
