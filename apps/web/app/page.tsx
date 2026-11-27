'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { health, startFromFile, startFromLink, type TemplateInfo } from '@/lib/api';

type Mode = 'link' | 'upload';

function detect(source: string): { ok: boolean; text: string } | null {
  const url = source.trim();
  if (!url) return null;
  if (/youtu\.?be/i.test(url)) return { ok: true,  text: '유튜브 링크로 인식했어요.' };
  if (/^https?:\/\/\S+\.\S+/i.test(url)) return { ok: true, text: '블로그 글로 인식했어요.' };
  return { ok: false, text: '주소를 확인할 수 없어요.' };
}

const GENRES = ['예능', '정보', '인터뷰', '강의', '팟캐스트'];
const LENGTHS = [
  { label: '15~30초', min: 15, max: 30 },
  { label: '20~60초', min: 20, max: 60 },
  { label: '60~90초', min: 60, max: 90 },
];

// 테마 스와치 색상
const THEME_SWATCH: Record<string, string> = {
  'a-black': '#111111',
  'b-white': '#e8e8e8',
  'c-yellow': '#FFD600',
};

export default function InputPage() {
  const router = useRouter();
  const [mode, setMode]         = useState<Mode>('link');
  const [source, setSource]     = useState('');
  const [file, setFile]         = useState<File | null>(null);
  const [rights, setRights]     = useState(false);
  const [genre, setGenre]       = useState('');
  const [prompt, setPrompt]     = useState('');
  const [length, setLength]     = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [offline, setOffline]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    health()
      .then((info) => {
        setTemplates(info.templates);
        setOffline(info.offline);
        if (info.templates[0]) setSelectedTemplate(info.templates[0].id);
      })
      .catch(() => setError('API 서버에 연결하지 못했어요. 서버가 떠 있는지 확인해 주세요.'));
  }, []);

  const detected = mode === 'link' ? detect(source) : null;
  const ready    = rights && (mode === 'link' ? Boolean(detected?.ok) : Boolean(file));

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const job =
        mode === 'link'
          ? await startFromLink({
              source: source.trim(),
              rightsAttested: true,
              genre: genre || undefined,
              prompt: prompt.trim() || undefined,
              minSec: LENGTHS[length]!.min,
              maxSec: LENGTHS[length]!.max,
            })
          : await startFromFile(file!, genre || undefined);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '시작하지 못했어요.');
      setBusy(false);
    }
  }

  return (
    <main className="page" style={{ maxWidth: 640 }}>

      {/* 히어로 */}
      <div className="inp-hero">
        <div className="inp-pill">AI 쇼츠 자동 생성</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', letterSpacing: '-1px', lineHeight: 1.1 }}>
          영상 하나면<br />
          <span className="grad-text">쇼츠가 완성돼요</span>
        </h1>
        <p className="lede">AI가 핵심 장면을 골라 세로 쇼츠로 만들어 드려요. 자막, 제목, 테마까지 한 번에 완성.</p>
      </div>

      {offline ? (
        <div className="notice">오프라인 모드로 돌고 있어요. 실제 AI를 부르지 않으니 결과 품질은 의미가 없습니다.</div>
      ) : null}

      {/* 입력 소스 */}
      <section className="card">
        <div className="row" role="group" aria-label="입력 방식">
          <button type="button" className="toggle" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>
            링크 붙여넣기
          </button>
          <button type="button" className="toggle" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>
            MP4 올리기
          </button>
        </div>

        {mode === 'link' ? (
          <div className="field">
            <label className="label" htmlFor="source">유튜브 또는 블로그 주소</label>
            <input
              id="source" type="url" placeholder="https://"
              value={source} onChange={(e) => setSource(e.target.value)}
            />
            {detected ? (
              <div className="hint" style={{ color: detected.ok ? 'var(--positive)' : 'var(--critical)', fontWeight: 600 }}>
                {detected.text}
              </div>
            ) : (
              <div className="hint">유튜브 링크, 네이버 블로그·티스토리 주소를 넣을 수 있어요.</div>
            )}
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="file">영상 파일</label>
            <input
              id="file" type="file"
              accept="video/mp4,video/quicktime,video/x-matroska"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="hint">
              {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)` : 'MP4 파일을 골라 주세요.'}
            </div>
          </div>
        )}

        <div>
          <button
            type="button" className="btn-quiet toggle"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            {advanced ? '고급 설정 접기' : '고급 설정'}
          </button>
        </div>

        {advanced ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <span className="label">장르</span>
              <div className="row">
                <button type="button" className="toggle" aria-pressed={genre === ''} onClick={() => setGenre('')}>자동</button>
                {GENRES.map((g) => (
                  <button key={g} type="button" className="toggle" aria-pressed={genre === g} onClick={() => setGenre(g)}>{g}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">원하는 길이</span>
              <div className="row">
                {LENGTHS.map((l, i) => (
                  <button key={l.label} type="button" className="toggle" aria-pressed={length === i} onClick={() => setLength(i)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="prompt">이런 부분만 뽑아 주세요 (선택)</label>
              <input
                id="prompt" type="text"
                placeholder="예: 라면 끓이는 방법에 대한 부분만"
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </section>

      {/* 테마 선택 */}
      {templates.length > 0 ? (
        <section className="card">
          <div>
            <h2>테마 선택</h2>
            <p className="hint" style={{ marginTop: 4 }}>결과 화면에서 클립마다 바꿀 수 있어요.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplate(t.id)}
                style={{
                  border: `1.5px solid ${selectedTemplate === t.id ? 'var(--v)' : 'var(--border-2)'}`,
                  background: selectedTemplate === t.id ? 'rgba(124,58,237,.05)' : 'var(--bg)',
                  borderRadius: 'var(--r)', padding: '14px 10px 12px',
                  cursor: 'pointer', transition: 'all .2s cubic-bezier(.22,1,.36,1)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  transform: selectedTemplate === t.id ? 'translateY(-2px)' : 'none',
                  boxShadow: selectedTemplate === t.id ? '0 6px 20px rgba(124,58,237,.18)' : 'none',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: THEME_SWATCH[t.id] ?? '#888',
                  border: t.id === 'b-white' ? '1px solid #ccc' : 'none',
                }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg)' }}>{t.name}</span>
                {t.description ? (
                  <span style={{ fontSize: 10.5, color: 'var(--fg-3)', textAlign: 'center', lineHeight: 1.4 }}>{t.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* 저작권 + 시작 */}
      <section className="card">
        <label
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '13px 15px',
            background: 'rgba(245,158,11,.04)', border: '1px solid rgba(245,158,11,.15)',
            borderRadius: 'var(--r-sm)', cursor: 'pointer',
          }}
        >
          <input
            type="checkbox" checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--warn)' }}>저작권 확인</strong>
            {' '}— 이 콘텐츠의 저작권자이거나 편집·재업로드 권한이 있음을 확인합니다.
          </span>
        </label>

        {error ? <div className="error">{error}</div> : null}

        <button
          type="button"
          disabled={!ready || busy}
          onClick={start}
          style={{
            width: '100%', padding: '15px',
            background: 'linear-gradient(135deg, var(--v), var(--v2))',
            color: 'white', border: 'none', borderRadius: 'var(--r)',
            fontSize: 15, fontWeight: 800, fontFamily: 'inherit',
            cursor: !ready || busy ? 'not-allowed' : 'pointer',
            opacity: !ready || busy ? .4 : 1,
            transition: 'all .2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
            boxShadow: ready && !busy ? '0 8px 32px rgba(124,58,237,.35)' : 'none',
          }}
        >
          <svg viewBox="0 0 20 20" width="17" height="17" fill="white">
            <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm-1 11.5V6.5l5 3.5-5 3.5z" />
          </svg>
          {busy ? '시작하는 중…' : '쇼츠 만들기 시작'}
        </button>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--fg-3)', margin: 0 }}>
          평균 2–3분 완성 · 클립 최대 5개
        </p>
      </section>
    </main>
  );
}
