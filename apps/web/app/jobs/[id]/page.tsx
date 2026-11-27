'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getJob, retryJob, watchJob, type JobView } from '@/lib/api';

const VIDEO_STEPS = [
  { id: 'ingest',      label: '영상 다운로드' },
  { id: 'transcribe',  label: '음성 인식' },
  { id: 'highlight',   label: '하이라이트 추출' },
  { id: 'compose',     label: '자막·테마 합성' },
];

const BLOG_STEPS = [
  { id: 'fetch',   label: '글 가져오기' },
  { id: 'script',  label: '대본 쓰기' },
  { id: 'images',  label: '이미지 가져오기' },
  { id: 'tts',     label: '나레이션 만들기' },
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
          API 서버에 연결하지 못했어요.
          <Link href="/" className="btn-quiet" style={{ alignSelf: 'flex-start' }}>처음으로</Link>
        </div>
      </main>
    );
  }

  if (!job) {
    return <main className="page"><p className="lede">불러오는 중…</p></main>;
  }

  const steps = looksLikeBlog(job) ? BLOG_STEPS : VIDEO_STEPS;
  const activeIndex = steps.findIndex((s) => s.id === job.progress.stage);
  const pct = Math.round(job.progress.pct * 100);

  return (
    <main className="page" style={{ maxWidth: 640 }}>
      <div>
        <h1 style={{ marginBottom: 6 }}>
          {job.state === 'failed' ? '만들지 못했어요' : '처리 중'}
        </h1>
        <p className="lede" style={{ fontSize: 13 }}>완성까지 약 2분 소요돼요 · 이 화면을 떠나도 작업은 계속돼요</p>
      </div>

      {job.state === 'failed' && job.error ? (
        <div className="error">
          <div style={{ fontWeight: 600 }}>{job.error.message}</div>
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
              <span className="hint">다른 주소로 해 보세요.</span>
            )}
            <Link href="/" className="btn-quiet" style={{ textDecoration: 'none' }}>처음으로</Link>
          </div>
        </div>
      ) : null}

      {/* 단계 카드 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {steps.map((step, i) => {
          const done   = activeIndex > i || job.state === 'done';
          const active = activeIndex === i && job.state === 'running';
          const wait   = !done && !active;

          return (
            <div
              key={step.id}
              className={`scard${done ? ' done' : active ? ' run' : ''}`}
              style={{ animation: `fade-up .4s ${(.06 + i * .08).toFixed(2)}s cubic-bezier(.22,1,.36,1) both` }}
            >
              {/* 아이콘 */}
              <div
                style={{
                  width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? 'rgba(22,163,74,.1)' : active ? 'rgba(124,58,237,.18)' : 'var(--bg-4)',
                  animation: active ? 'icpulse 1.4s ease-in-out infinite' : undefined,
                }}
              >
                {done ? (
                  <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
                    <path d="M3 8l3.5 3.5L13 4.5" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--v)', borderTopColor: 'transparent', display: 'block', animation: 'spin .8s linear infinite' }} />
                ) : (
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bg-5)', display: 'block' }} />
                )}
              </div>

              {/* 본문 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--fg)' }}>{step.label}</div>
                {active && job.progress.label ? (
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 1 }}>{job.progress.label}</div>
                ) : null}
                {active ? (
                  <div style={{ marginTop: 7 }}>
                    <div style={{ height: 3, background: 'var(--bg-4)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        background: 'linear-gradient(90deg,var(--v),#818cf8 50%,#67e8f9)',
                        backgroundSize: '200%',
                        animation: 'sbar-shim 2s linear infinite',
                        width: `${pct}%`,
                        borderRadius: 2,
                      }} />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 오른쪽 배지 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
                  background: done ? 'rgba(22,163,74,.1)' : active ? 'rgba(124,58,237,.1)' : 'var(--bg-3)',
                  color: done ? '#15803d' : active ? 'var(--v)' : 'var(--fg-3)',
                  border: `1px solid ${done ? 'rgba(22,163,74,.2)' : active ? 'rgba(124,58,237,.22)' : 'var(--border)'}`,
                }}>
                  {done ? '완료' : active ? '진행 중' : '대기'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 전체 진행률 */}
      <div style={{
        background: 'var(--bg-2)', border: '1px solid var(--border)',
        borderRadius: 'var(--r)', padding: 18,
        animation: 'fade-up .4s .5s cubic-bezier(.22,1,.36,1) both',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>전체 진행률</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--v)' }}>{pct}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </main>
  );
}

function looksLikeBlog(job: JobView): boolean {
  return BLOG_STEPS.some((s) => s.id === job.progress.stage) && job.progress.stage !== 'compose';
}
