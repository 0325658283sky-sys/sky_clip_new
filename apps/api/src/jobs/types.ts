export type JobKind = 'analyze' | 'render';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface JobProgress {
  stage: string;
  label: string;
  /** 0~1 */
  pct: number;
}

export interface JobError {
  /** 기계가 보는 사유. 재시도 가능 여부를 가른다. */
  reason: string;
  /** 사용자에게 그대로 보여 줄 말 */
  message: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: JobProgress;
  error?: JobError;
  /** 작업 종류마다 다른 입력 */
  input: Record<string, unknown>;
  /** 끝났을 때의 결과 */
  result?: Record<string, unknown>;
  attempts: number;
}

/** 다시 해 볼 만한 실패인가. 사용자 잘못이면 재시도해도 같은 결과다. */
const PERMANENT = new Set([
  'private',
  'age_restricted',
  'geo_blocked',
  'members_only',
  'unavailable',
  'too_long',
  'not_found',
  'forbidden',
  'not_html',
  'too_large',
  'no_clips',
]);

export function isRetryable(error: JobError | undefined): boolean {
  if (!error) return false;
  return !PERMANENT.has(error.reason);
}

export function newJob(kind: JobKind, input: Record<string, unknown>): Job {
  return {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    state: 'queued',
    createdAt: new Date().toISOString(),
    progress: { stage: 'queued', label: '차례를 기다리는 중', pct: 0 },
    input,
    attempts: 0,
  };
}
