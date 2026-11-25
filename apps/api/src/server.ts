import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { Project } from '@skycut/schema';
import { TEMPLATES } from '@skycut/templates';
import {
  DOWNLOAD_DIR,
  JOB_DIR,
  MAX_UPLOAD_BYTES,
  MEDIA_DIR,
  OFFLINE,
  PROJECT_DIR,
  UPLOAD_DIR,
} from './config.js';
import { runAnalyze } from './jobs/analyze.js';
import { JobQueue } from './jobs/queue.js';
import { runRender } from './jobs/render.js';
import { JobStore } from './jobs/store.js';
import { isRetryable, type Job } from './jobs/types.js';

for (const dir of [PROJECT_DIR, JOB_DIR, UPLOAD_DIR, DOWNLOAD_DIR, MEDIA_DIR]) {
  mkdirSync(dir, { recursive: true });
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function projectPath(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('잘못된 프로젝트 id');
  return join(PROJECT_DIR, `${id}.json`);
}

function publicJob(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    progress: job.progress,
    error: job.error,
    retryable: isRetryable(job.error),
    result: job.result,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

export function buildServer(): { app: FastifyInstance; queue: JobQueue; store: JobStore } {
  const store = new JobStore(JOB_DIR);
  const queue = new JobQueue(store);
  queue.register('analyze', runAnalyze);
  queue.register('render', runRender);
  queue.recoverInterrupted();

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  void app.register(cors, { origin: true });
  void app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  void app.register(fastifyStatic, { root: MEDIA_DIR, prefix: '/media/', decorateReply: false });
  void app.register(fastifyStatic, { root: DOWNLOAD_DIR, prefix: '/downloads/', decorateReply: true });

  app.get('/api/health', async () => ({
    ok: true,
    offline: OFFLINE,
    templates: Object.values(TEMPLATES).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      suitedFor: t.suitedFor,
    })),
  }));

  /** 링크 입력 */
  app.post('/api/projects', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const source = String(body.source ?? '').trim();
    if (!source) return reply.code(400).send({ error: '주소를 입력해 주세요.' });
    if (!body.rightsAttested) {
      return reply.code(400).send({ error: '사용 권리 확인에 동의해야 시작할 수 있어요.' });
    }

    const job = queue.add('analyze', {
      projectId: newProjectId(),
      source,
      rightsAttested: true,
      genre: body.genre ? String(body.genre) : undefined,
      prompt: body.prompt ? String(body.prompt) : undefined,
      minSec: body.minSec ? Number(body.minSec) : undefined,
      maxSec: body.maxSec ? Number(body.maxSec) : undefined,
      maxClips: body.maxClips ? Number(body.maxClips) : undefined,
    });
    return reply.code(202).send(publicJob(job));
  });

  /** 파일 업로드 */
  app.post('/api/projects/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: '영상 파일이 없어요.' });

    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const attested = String(fields.rightsAttested?.value ?? '') === 'true';
    if (!attested) {
      return reply.code(400).send({ error: '사용 권리 확인에 동의해야 시작할 수 있어요.' });
    }

    const projectId = newProjectId();
    const safeName = file.filename.replace(/[^\w.\-]/g, '_').slice(-80) || 'upload.mp4';
    const saved = join(UPLOAD_DIR, `${projectId}-${safeName}`);
    await pipeline(file.file, createWriteStream(saved));
    if (file.file.truncated) {
      return reply.code(413).send({ error: '파일이 너무 커요.' });
    }

    const job = queue.add('analyze', {
      projectId,
      source: saved,
      rightsAttested: true,
      genre: fields.genre?.value ? String(fields.genre.value) : undefined,
    });
    return reply.code(202).send(publicJob(job));
  });

  app.get('/api/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = queue.get(id);
    if (!job) return reply.code(404).send({ error: '작업을 찾을 수 없어요.' });
    return publicJob(job);
  });

  app.post('/api/jobs/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = queue.retry(id);
    if (!job) return reply.code(409).send({ error: '다시 시도할 수 없는 작업이에요.' });
    return publicJob(job);
  });

  app.post('/api/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!queue.cancel(id)) return reply.code(409).send({ error: '취소할 수 없는 작업이에요.' });
    return { ok: true };
  });

  /** 진행률 실시간 전달 */
  app.get('/api/jobs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = queue.get(id);
    if (!job) return reply.code(404).send({ error: '작업을 찾을 수 없어요.' });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send(publicJob(job));

    const stop = queue.subscribe(id, (updated) => {
      send(publicJob(updated));
      if (updated.state === 'done' || updated.state === 'failed' || updated.state === 'canceled') {
        reply.raw.end();
      }
    });
    // 중간 장비가 끊지 않도록 주기적으로 주석 줄을 보낸다
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    request.raw.on('close', () => {
      clearInterval(ping);
      stop();
    });
    reply.raw.on('close', () => {
      clearInterval(ping);
      stop();
    });
    return reply;
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let path: string;
    try {
      path = projectPath(id);
    } catch {
      return reply.code(400).send({ error: '잘못된 주소예요.' });
    }
    if (!existsSync(path)) return reply.code(404).send({ error: '프로젝트를 찾을 수 없어요.' });
    return Project.parse(JSON.parse(readFileSync(path, 'utf8')));
  });

  /** 렌더 요청 */
  app.post('/api/projects/:id/clips/:clipId/render', async (request, reply) => {
    const { id, clipId } = request.params as { id: string; clipId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!SAFE_ID.test(id) || !SAFE_ID.test(clipId)) {
      return reply.code(400).send({ error: '잘못된 주소예요.' });
    }
    if (!existsSync(projectPath(id))) {
      return reply.code(404).send({ error: '프로젝트를 찾을 수 없어요.' });
    }
    const templateId = body.templateId ? String(body.templateId) : undefined;
    if (templateId && !(templateId in TEMPLATES)) {
      return reply.code(400).send({ error: `모르는 테마예요: ${templateId}` });
    }

    const job = queue.add('render', {
      projectId: id,
      clipId,
      templateId,
      titleIndex: body.titleIndex === undefined ? undefined : Number(body.titleIndex),
    });
    return reply.code(202).send(publicJob(job));
  });

  app.get('/api/projects', async () => {
    const ids = readdirSync(PROJECT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    return { projects: ids };
  });

  return { app, queue, store };
}

function newProjectId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
