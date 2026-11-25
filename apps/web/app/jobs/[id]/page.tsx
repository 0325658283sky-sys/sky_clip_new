'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getJob, retryJob, watchJob, type JobView } from '@/lib/api';

/** 진행 화면에 보여 줄 단계. 워커가 보내는 stage id와 맞춘다. */
const VIDEO_STEPS = [
  { id: 'ingest', label: '영상 받기' },
  { id: 'transcribe', label: '말 받아쓰기' },
  { id: 'highlight', label: '볼 만한 구간 찾기' },
  { id: 'compose', label: '쇼츠 구성하기' },
];

const BLOG_STEPS = [
  { id: 'fetch', label: '글 가져오기' },
  { id: 'script', label: '대본 쓰기' },
  { id: 'images', label: '이미지 가져오기' },
  { id: 'tts', label: '나레이션 만들기' },
  { id: 'compose', label: '쇼츠 구성하기' },
];

export default function JobPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobView | null>(null);
  const [failedToConnect, setFailedToConnect] = useState(false);
  const navigated = useRef(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    getJob(params.id)
      .then((initial) => {
        setJob(initial);
        stop = watchJob(params.id, setJob);
      })
      .catch(() => setFailedToConnect(true));
    return () => stop?.();
  }, [params.id]);

  // 끝나면 결과 화면으로
  useEffect(() => {
    if (navigated.current) return;
    if (job?.state === 'done' && job.kind === 'analyze') {
      const projectId = job.result?.projectId;
      if (typeof projectId === 'string') {
        navigated.current = true;
        router.replace(`/projects/${projectId}`);
      }
    }
  }, [job, router]);

  if (failedToConnect) {
    return (
      <main className="page">
        <div className="error">
          API 서버에 연결하지 못했어요. 서버가 떠 있는지 확인해 주세요.
          <Link href="/" className="btn-quiet toggle" style={{ alignSelf: 'flex-start' }}>
            처음으로
          </Link>
        </div>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="page">
        <p className="lede">불러오는 중…</p>
      </main>
    );
  }

  const steps = looksLikeBlog(job) ? BLOG_STEPS : VIDEO_STEPS;
  const activeIndex = steps.findIndex((s) => s.id === job.progress.stage);
  const pct = Math.round(job.progress.pct * 100);

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <h1>{job.state === 'failed' ? '만들지 못했어요' : '쇼츠를 만들고 있어요'}</h1>

      {job.state === 'failed' && job.error ? (
        <div className="error">
          <div style={{ fontWeight: 500 }}>{job.error.message}</div>
          <div className="row">
            {job.retryable ? (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const next = await retryJob(job.id);
                  setJob(next);
                  watchJob(job.id, setJob);
                }}
              >
                다시 시도
              </button>
            ) : (
              <span className="hint">다시 시도해도 같은 결과예요. 다른 주소로 해 보세요.</span>
            )}
            <Link href="/" className="toggle btn-quiet">
              처음으로
            </Link>
          </div>
        </div>
      ) : null}

      <section className="card">
        <div className="field">
          <div
            className="progress-track"
            role="progressbar"
            aria-label="전체 진행률"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--ink-muted)' }}>{job.progress.label}</span>
            <span className="mono" style={{ color: 'var(--ink-muted)' }}>
              {pct}%
            </span>
          </div>
        </div>

        <ol className="steps">
          {steps.map((step, i) => {
            const done = activeIndex > i || job.state === 'done';
            const active = activeIndex === i && job.state === 'running';
            return (
              <li key={step.id}>
                <span aria-hidden="true" style={{ width: 20, textAlign: 'center' }}>
                  {done ? '●' : active ? '◐' : '○'}
                </span>
                <span style={{ flex: 1, fontWeight: 500, color: done || active ? 'var(--ink)' : 'var(--ink-faint)' }}>
                  {step.label}
                </span>
                <span className={`state ${done ? 'state-done' : active ? 'state-active' : 'state-wait'}`}>
                  {done ? '완료' : active ? '진행 중' : '대기'}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="hint">이 화면을 떠나도 작업은 계속돼요.</p>
      </section>
    </main>
  );
}

function looksLikeBlog(job: JobView): boolean {
  return BLOG_STEPS.some((s) => s.id === job.progress.stage) && job.progress.stage !== 'compose';
}
