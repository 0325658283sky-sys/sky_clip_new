/**
 * 분석 작업 — 워커(파이썬)를 띄우고 stdout의 JSON 줄을 진행률로 옮긴다.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  MEDIA_DIR,
  OFFLINE,
  PROJECT_DIR,
  PYTHON,
  ROOT,
  STT_ENGINE,
  TTS_PROVIDER,
  WORKER_DIR,
} from '../config.js';
import type { JobContext } from './queue.js';
import type { JobError } from './types.js';

export interface AnalyzeInput {
  projectId: string;
  source: string;
  rightsAttested: boolean;
  genre?: string;
  prompt?: string;
  minSec?: number;
  maxSec?: number;
  maxClips?: number;
}

export async function runAnalyze(ctx: JobContext): Promise<Record<string, unknown>> {
  const input = ctx.job.input as unknown as AnalyzeInput;
  const outPath = join(PROJECT_DIR, `${input.projectId}.json`);

  const args = [
    '-m', 'skycut_worker.cli', 'run', input.source,
    '--out', outPath,
    '--store', MEDIA_DIR,
    '--project-id', input.projectId,
    '--engine', STT_ENGINE,
    '--tts', TTS_PROVIDER,
    '--json-progress',
  ];
  if (input.rightsAttested) args.push('--rights');
  if (OFFLINE) args.push('--offline');
  if (input.genre) args.push('--genre', input.genre);
  if (input.prompt) args.push('--prompt', input.prompt);
  if (input.minSec) args.push('--min-sec', String(input.minSec));
  if (input.maxSec) args.push('--max-sec', String(input.maxSec));
  if (input.maxClips) args.push('--max-clips', String(input.maxClips));

  return runWorker(args, ctx, (payload) => ({
    projectPath: outPath,
    projectId: input.projectId,
    clips: payload.clips ?? 0,
  }));
}

type DonePayload = { project?: string; clips?: number };

export function runWorker(
  args: string[],
  ctx: JobContext,
  onDone: (payload: DonePayload) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, args, {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: WORKER_DIR, PYTHONIOENCODING: 'utf-8' },
    });

    let failure: JobError | null = null;
    let donePayload: DonePayload | null = null;
    const stderr: string[] = [];

    const abort = () => child.kill();
    ctx.signal.addEventListener('abort', abort, { once: true });

    createInterface({ input: child.stdout }).on('line', (line) => {
      const text = line.trim();
      if (!text.startsWith('{')) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return; // JSON이 아니면 사람용 출력이다
      }
      if (event.event === 'progress') {
        ctx.report({
          stage: String(event.stage ?? ''),
          label: String(event.label ?? ''),
          pct: Number(event.pct ?? 0),
        });
      } else if (event.event === 'done') {
        donePayload = { project: event.project as string, clips: Number(event.clips ?? 0) };
      } else if (event.event === 'error') {
        failure = { reason: String(event.reason ?? 'unknown'), message: String(event.message ?? '') };
      }
    });

    createInterface({ input: child.stderr }).on('line', (line) => {
      if (stderr.length < 40) stderr.push(line);
    });

    child.on('error', (err) => {
      ctx.signal.removeEventListener('abort', abort);
      reject({ reason: 'spawn_failed', message: `워커를 실행하지 못했어요: ${err.message}` });
    });

    child.on('close', (code) => {
      ctx.signal.removeEventListener('abort', abort);
      if (ctx.signal.aborted) {
        reject({ reason: 'canceled', message: '취소했어요.' });
        return;
      }
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject({
          reason: 'worker_failed',
          message: stderr.at(-1) ?? `워커가 오류로 끝났어요 (코드 ${code}).`,
        });
        return;
      }
      resolve(onDone(donePayload ?? {}));
    });
  });
}
