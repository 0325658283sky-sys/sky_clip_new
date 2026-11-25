'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Project, type Clip } from '@skycut/schema';
import { TEMPLATES } from '@skycut/templates';
import { ShortPreview } from '@/components/ShortPreview';
import { downloadUrl, getProject, requestRender, watchJob, type JobView } from '@/lib/api';

const TEMPLATE_LIST = Object.values(TEMPLATES);
const PREVIEW_WIDTH = 216;

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProject(params.id)
      .then((raw) => setProject(Project.parse(raw)))
      .catch((err) => setError(err instanceof Error ? err.message : '불러오지 못했어요.'));
  }, [params.id]);

  if (error) {
    return (
      <main className="page">
        <div className="error">
          {error}
          <Link href="/" className="toggle btn-quiet" style={{ alignSelf: 'flex-start' }}>
            처음으로
          </Link>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="page">
        <p className="lede">불러오는 중…</p>
      </main>
    );
  }

  const source = project.article?.title ?? project.input.url ?? '올린 영상';

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1>쇼츠 {project.clips.length}개를 만들었어요</h1>
          <p className="lede">
            원본: {source} · 점수가 높은 순서예요
          </p>
        </div>
        <Link href="/" className="toggle btn-quiet">
          새로 만들기
        </Link>
      </div>

      <div className="grid">
        {project.clips.map((clip, i) => (
          <ClipCard key={clip.id} project={project} clip={clip} index={i + 1} />
        ))}
      </div>
    </main>
  );
}

function ClipCard({ project, clip, index }: { project: Project; clip: Clip; index: number }) {
  const [templateId, setTemplateId] = useState(clip.appliedTemplateId);
  const [titleIndex, setTitleIndex] = useState(clip.selectedTitleIndex);
  const [render, setRender] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const titles = clip.content.titles;
  const score = clip.content.score.total.toFixed(1);

  async function download() {
    setError(null);
    try {
      const job = await requestRender(project.id, clip.id, { templateId, titleIndex });
      setRender(job);
      watchJob(job.id, (updated) => {
        setRender(updated);
        if (updated.state === 'done') {
          const url = updated.result?.downloadUrl;
          if (typeof url === 'string') window.location.href = downloadUrl(url);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '만들지 못했어요.');
    }
  }

  const rendering = render?.state === 'queued' || render?.state === 'running';
  const pct = Math.round((render?.progress.pct ?? 0) * 100);

  return (
    <article className="card">
      <div className="row" style={{ gap: 8 }}>
        <h2 style={{ flex: 1 }}>쇼츠 {index}</h2>
        <span className="badge">
          점수 <span className="mono">{score}</span>
        </span>
      </div>

      <div className="preview-frame">
        <ShortPreview
          project={project}
          clip={clip}
          templateId={templateId}
          titleIndex={titleIndex}
          width={PREVIEW_WIDTH}
        />
      </div>

      <div className="row" role="group" aria-label="테마">
        {TEMPLATE_LIST.map((t) => (
          <button
            key={t.id}
            type="button"
            className="toggle"
            style={{ flex: 1 }}
            aria-pressed={templateId === t.id}
            onClick={() => setTemplateId(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {clip.content.reason ? (
        <div className="field">
          <span className="label">추천 이유</span>
          <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>{clip.content.reason}</span>
        </div>
      ) : null}

      <fieldset>
        <legend className="label">제목</legend>
        {titles.map((t, i) => (
          <label className="choice" key={i} htmlFor={`${clip.id}-title-${i}`}>
            <input
              id={`${clip.id}-title-${i}`}
              type="radio"
              name={`${clip.id}-title`}
              checked={titleIndex === i}
              onChange={() => setTitleIndex(i)}
            />
            <span>
              {t.line1} {t.line2}
            </span>
          </label>
        ))}
      </fieldset>

      {error ? <div className="error">{error}</div> : null}
      {render?.state === 'failed' && render.error ? <div className="error">{render.error.message}</div> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="btn" onClick={download} disabled={rendering}>
          {rendering ? `만드는 중 ${pct}%` : '1080p 다운로드'}
        </button>
        {rendering ? (
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        {render?.state === 'done' ? (
          <div className="row" style={{ justifyContent: 'center', color: 'var(--positive)', fontWeight: 500 }}>
            다운로드를 시작했어요
          </div>
        ) : null}
      </div>
    </article>
  );
}
