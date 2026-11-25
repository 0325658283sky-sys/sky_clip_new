/**
 * 작업 큐.
 *
 * 지금은 **한 프로세스 안에서** 돌린다. 상태는 디스크에 남기므로 서버를
 * 다시 띄워도 결과를 잃지 않는다. 여러 대로 늘릴 때 이 인터페이스 뒤에
 * Redis + BullMQ를 끼우면 되고, 라우트와 워커 코드는 바뀌지 않는다.
 *
 * MVP는 한 대에서 돌아가므로 Redis를 띄우지 않아도 `npm run dev`가 된다.
 */
import { EventEmitter } from 'node:events';
import { CONCURRENCY } from '../config.js';
import { JobStore } from './store.js';
import { type Job, type JobError, type JobKind, type JobProgress, newJob } from './types.js';

export interface JobContext {
  job: Job;
  report: (progress: JobProgress) => void;
  signal: AbortSignal;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

export class JobQueue {
  private readonly handlers = new Map<JobKind, JobHandler>();
  private readonly waiting: string[] = [];
  private readonly running = new Map<string, AbortController>();
  private readonly events = new EventEmitter();

  constructor(private readonly store: JobStore, private readonly concurrency = CONCURRENCY) {
    this.events.setMaxListeners(0);
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  /** 서버가 꺼질 때 돌고 있던 작업은 되살릴 수 없으므로 실패로 적는다. */
  recoverInterrupted(): void {
    for (const job of this.store.list()) {
      if (job.state !== 'running') continue;
      this.store.update(job.id, {
        state: 'failed',
        finishedAt: new Date().toISOString(),
        error: { reason: 'interrupted', message: '서버가 다시 시작돼 작업이 끊겼어요. 다시 시도해 주세요.' },
      });
    }
  }

  add(kind: JobKind, input: Record<string, unknown>): Job {
    const job = newJob(kind, input);
    this.store.save(job);
    this.waiting.push(job.id);
    this.emit(job);
    queueMicrotask(() => this.pump());
    return job;
  }

  retry(id: string): Job | null {
    const job = this.store.get(id);
    if (!job || (job.state !== 'failed' && job.state !== 'canceled')) return null;
    const next = this.store.update(id, {
      state: 'queued',
      progress: { stage: 'queued', label: '다시 차례를 기다리는 중', pct: 0 },
      error: undefined,
      finishedAt: undefined,
      attempts: job.attempts,
    });
    if (next) {
      this.waiting.push(id);
      this.emit(next);
      queueMicrotask(() => this.pump());
    }
    return next;
  }

  cancel(id: string): boolean {
    const controller = this.running.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    const at = this.waiting.indexOf(id);
    if (at >= 0) {
      this.waiting.splice(at, 1);
      const job = this.store.update(id, {
        state: 'canceled',
        finishedAt: new Date().toISOString(),
      });
      if (job) this.emit(job);
      return true;
    }
    return false;
  }

  get(id: string): Job | null {
    return this.store.get(id);
  }

  /** SSE용. 그 작업이 바뀔 때마다 부른다. */
  subscribe(id: string, listener: (job: Job) => void): () => void {
    const channel = `job:${id}`;
    this.events.on(channel, listener);
    return () => this.events.off(channel, listener);
  }

  // ── 내부 ────────────────────────────────────────────────

  private emit(job: Job): void {
    this.events.emit(`job:${job.id}`, job);
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift();
      if (!id) break;
      void this.run(id);
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.store.get(id);
    if (!job || job.state === 'canceled') return;

    const handler = this.handlers.get(job.kind);
    if (!handler) {
      this.finish(id, 'failed', {
        error: { reason: 'no_handler', message: `처리기를 찾을 수 없어요: ${job.kind}` },
      });
      return;
    }

    const controller = new AbortController();
    this.running.set(id, controller);

    const started = this.store.update(id, {
      state: 'running',
      startedAt: new Date().toISOString(),
      attempts: job.attempts + 1,
      progress: { stage: 'start', label: '시작하는 중', pct: 0.01 },
    });
    if (started) this.emit(started);

    try {
      const result = await handler({
        job: started ?? job,
        report: (progress) => {
          const updated = this.store.update(id, { progress });
          if (updated) this.emit(updated);
        },
        signal: controller.signal,
      });
      this.finish(id, 'done', { result, progress: { stage: 'done', label: '완료', pct: 1 } });
    } catch (err) {
      const aborted = controller.signal.aborted;
      this.finish(id, aborted ? 'canceled' : 'failed', {
        error: aborted ? undefined : toJobError(err),
      });
    } finally {
      this.running.delete(id);
      this.pump();
    }
  }

  private finish(id: string, state: Job['state'], patch: Partial<Job>): void {
    const job = this.store.update(id, { ...patch, state, finishedAt: new Date().toISOString() });
    if (job) this.emit(job);
  }
}

export function toJobError(err: unknown): JobError {
  if (err && typeof err === 'object' && 'reason' in err && 'message' in err) {
    return { reason: String(err.reason), message: String(err.message) };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { reason: 'unknown', message: message || '알 수 없는 오류가 났어요.' };
}
