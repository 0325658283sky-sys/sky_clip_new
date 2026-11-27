'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Project, type Clip } from '@skycut/schema';
import { TEMPLATES } from '@skycut/templates';
import { ShortPreview, type ShortPreviewHandle } from '@/components/ShortPreview';
import { downloadUrl, getProject, requestRender, watchJob, type JobView } from '@/lib/api';

const TEMPLATE_LIST = Object.values(TEMPLATES);
const PREVIEW_WIDTH = 190;

// 클립 순서에 따른 썸네일 배경색
const THUMB_BG = ['#1e1040', '#0a1a3a', '#1a0a30', '#0a2a18', '#2a160a'];

export default function ResultPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const previewRef = useRef<ShortPreviewHandle>(null);

  useEffect(() => {
    getProject(params.id)
      .then((raw) => setProject(Project.parse(raw)))
      .catch((err) => setError(err instanceof Error ? err.message : '불러오지 못했어요.'));
  }, [params.id]);

  const handleActivate = useCallback((i: number) => {
    previewRef.current?.pause();
    setActiveIdx(i);
  }, []);

  if (error) {
    return (
      <main className="page">
        <div className="error">
          {error}
          <Link href="/" className="btn-quiet" style={{ alignSelf: 'flex-start' }}>
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
  const activeClip = project.clips[activeIdx];

  return (
    <>
      {/* 상단 바 */}
      <div className="results-topbar">
        <div className="results-topbar-l">
          <h2>쇼츠 {project.clips.length}개 완성</h2>
          <span>· {source}</span>
        </div>
        <Link href="/" className="btn-new">새로 만들기</Link>
      </div>

      <div className="results-layout">
        {/* 왼쪽 사이드바 */}
        <aside className="res-sidebar">
          <div className="res-sidebar-head">
            <h3>추출된 클립</h3>
            <p>점수 높은 순</p>
          </div>
          <div className="clips-ul">
            {project.clips.map((clip, i) => {
              const title = clip.content.titles[0];
              return (
                <div
                  key={clip.id}
                  className={`clip-li${i === activeIdx ? ' on' : ''}`}
                  style={{ animation: `fade-up .38s ${(.06 + i * .08).toFixed(2)}s cubic-bezier(.22,1,.36,1) both` }}
                  onClick={() => handleActivate(i)}
                >
                  <div className="clip-li-thumb" style={{ background: THUMB_BG[i % THUMB_BG.length] }}>
                    <span className="clip-li-num-bg">{String(i + 1).padStart(2, '0')}</span>
                    <div className="clip-li-score">★{clip.content.score.total.toFixed(1)}</div>
                  </div>
                  <div className="clip-li-info">
                    <div className="clip-li-label">쇼츠 {i + 1}</div>
                    <div className="clip-li-title">{title?.line1} {title?.line2}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* 오른쪽 패널 */}
        <div className="clip-panel" key={activeIdx}>
          {activeClip && (
            <ActiveClipPanel
              project={project}
              clip={activeClip}
              index={activeIdx + 1}
              previewRef={previewRef}
            />
          )}
        </div>
      </div>
    </>
  );
}

function ActiveClipPanel({
  project,
  clip,
  index,
  previewRef,
}: {
  project: Project;
  clip: Clip;
  index: number;
  previewRef: React.RefObject<ShortPreviewHandle | null>;
}) {
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

  // 테마 색상 (스와치용)
  const THEME_SWATCH: Record<string, { bg: string; border?: string }> = {
    'a-black':  { bg: '#111111' },
    'b-white':  { bg: '#ffffff', border: '#ccc' },
    'c-yellow': { bg: '#FFD600' },
  };

  return (
    <>
      {/* 폰 미리보기 */}
      <div className="phone-wrap">
        <div className="phone-frame">
          <ShortPreview
            ref={previewRef}
            project={project}
            clip={clip}
            templateId={templateId}
            titleIndex={titleIndex}
            width={PREVIEW_WIDTH}
          />
        </div>
        <div className="phone-meta">{/* dur은 schema에 없으므로 생략 */}9:16 · 1080p</div>
      </div>

      {/* 컨트롤 */}
      <div className="ctrl-col">
        {/* 클립 헤더 */}
        <div className="clip-header">
          <div className="clip-header-top">
            <span className="clip-n">쇼츠 {index}</span>
            <span className="clip-score">★ {score}</span>
          </div>
          <div className="clip-header-title">
            {titles[titleIndex]?.line1}<br />{titles[titleIndex]?.line2}
          </div>
          {clip.content.reason ? (
            <div className="clip-header-reason">{clip.content.reason}</div>
          ) : null}
        </div>

        {/* 테마 */}
        <div>
          <div className="ctrl-sec-title">테마</div>
          <div className="theme-sel">
            {TEMPLATE_LIST.map((t) => {
              const swatch = THEME_SWATCH[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  className="th-btn"
                  aria-pressed={templateId === t.id}
                  onClick={() => setTemplateId(t.id)}
                >
                  <div
                    className="th-swatch"
                    style={{
                      background: swatch?.bg ?? '#888',
                      border: `1px solid ${swatch?.border ?? 'transparent'}`,
                    }}
                  />
                  <span style={{ fontSize: '10.5px' }}>{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 제목 */}
        <div>
          <div className="ctrl-sec-title">제목 선택</div>
          <fieldset style={{ gap: 6 }}>
            {titles.map((t, i) => (
              <label
                key={i}
                className={`topt${i === titleIndex ? ' on' : ''}`}
                onClick={() => setTitleIndex(i)}
              >
                <input
                  type="radio"
                  name={`title-${clip.id}`}
                  checked={titleIndex === i}
                  onChange={() => setTitleIndex(i)}
                />
                <span className="topt-txt">{t.line1} · {t.line2}</span>
              </label>
            ))}
          </fieldset>
        </div>

        {/* 내보내기 */}
        <div>
          <div className="ctrl-sec-title">내보내기</div>
          {error ? <div className="error" style={{ marginBottom: 8 }}>{error}</div> : null}
          {render?.state === 'failed' && render.error ? (
            <div className="error" style={{ marginBottom: 8 }}>{render.error.message}</div>
          ) : null}

          <button
            type="button"
            className="dl-btn"
            onClick={download}
            disabled={rendering}
          >
            <svg viewBox="0 0 20 20">
              <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm-1 10.586V6h2v6.586l2.293-2.293 1.414 1.414L10 16.414l-4.707-4.707 1.414-1.414L9 12.586z" />
            </svg>
            {rendering ? `렌더링 중 ${pct}%` : '1080p 다운로드'}
          </button>

          {rendering ? (
            <div className="dl-progress-track">
              <div className="dl-progress-bar" style={{ width: `${pct}%` }} />
            </div>
          ) : null}

          {render?.state === 'done' ? (
            <div style={{ textAlign: 'center', color: 'var(--positive)', fontWeight: 600, marginTop: 8, fontSize: 13 }}>
              다운로드를 시작했어요
            </div>
          ) : null}

          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-3)', marginTop: 8 }}>
            MP4 · H.264 · 최대 60초
          </div>
        </div>
      </div>
    </>
  );
}
