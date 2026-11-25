'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { health, startFromFile, startFromLink, type TemplateInfo } from '@/lib/api';

type Mode = 'link' | 'upload';

/** 입력 주소를 보고 무엇인지 알려 준다. 사용자가 붙여넣자마자 확인할 수 있게. */
function detect(source: string): { ok: boolean; text: string } | null {
  const url = source.trim();
  if (!url) return null;
  if (/youtu\.?be/i.test(url)) {
    return { ok: true, text: '유튜브 링크로 인식했어요. 하이라이트 구간을 찾아 쇼츠로 만들어요.' };
  }
  if (/^https?:\/\/\S+\.\S+/i.test(url)) {
    return { ok: true, text: '블로그 글로 인식했어요. 글 내용으로 나레이션 쇼츠를 만들어요.' };
  }
  return { ok: false, text: '주소를 확인할 수 없어요. https:// 로 시작하는 링크를 넣어 주세요.' };
}

const GENRES = ['예능', '정보', '인터뷰', '강의', '팟캐스트'];
const LENGTHS = [
  { label: '15~30초', min: 15, max: 30 },
  { label: '20~60초', min: 20, max: 60 },
  { label: '60~90초', min: 60, max: 90 },
];

export default function InputPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('link');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [genre, setGenre] = useState('');
  const [prompt, setPrompt] = useState('');
  const [length, setLength] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    health()
      .then((info) => {
        setTemplates(info.templates);
        setOffline(info.offline);
      })
      .catch(() => setError('API 서버에 연결하지 못했어요. 서버가 떠 있는지 확인해 주세요.'));
  }, []);

  const detected = mode === 'link' ? detect(source) : null;
  const ready = rights && (mode === 'link' ? Boolean(detected?.ok) : Boolean(file));

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
    <main className="page">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1>쇼츠 만들기</h1>
        <p className="lede">
          영상 링크나 블로그 주소를 넣으면 바로 올릴 수 있는 쇼츠를 몇 개 만들어 드려요.
        </p>
      </div>

      {offline ? (
        <div className="notice">
          오프라인 모드로 돌고 있어요. 실제 AI를 부르지 않으니 결과 품질은 의미가 없습니다.
        </div>
      ) : null}

      <section className="card">
        <div className="row" role="group" aria-label="입력 방식">
          <button type="button" className="toggle" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>
            링크 붙여넣기
          </button>
          <button type="button" className="toggle" aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>
            영상 올리기
          </button>
        </div>

        {mode === 'link' ? (
          <div className="field">
            <label className="label" htmlFor="source">
              유튜브 또는 블로그 주소
            </label>
            <input
              id="source"
              type="url"
              placeholder="https://"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            {detected ? (
              <div
                className="hint"
                style={{ color: detected.ok ? 'var(--positive)' : 'var(--critical)', fontWeight: 500 }}
              >
                {detected.text}
              </div>
            ) : (
              <div className="hint">유튜브 링크, 네이버 블로그·티스토리 같은 글 주소를 넣을 수 있어요.</div>
            )}
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="file">
              영상 파일
            </label>
            <input
              id="file"
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="hint">{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(0)}MB)` : 'MP4 파일을 골라 주세요.'}</div>
          </div>
        )}

        <div>
          <button type="button" className="btn-quiet toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
            {advanced ? '고급 설정 접기' : '고급 설정'}
          </button>
        </div>

        {advanced ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <span className="label">장르</span>
              <div className="row">
                <button type="button" className="toggle" aria-pressed={genre === ''} onClick={() => setGenre('')}>
                  자동
                </button>
                {GENRES.map((g) => (
                  <button key={g} type="button" className="toggle" aria-pressed={genre === g} onClick={() => setGenre(g)}>
                    {g}
                  </button>
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
              <label className="label" htmlFor="prompt">
                이런 부분만 뽑아 주세요 (선택)
              </label>
              <input
                id="prompt"
                type="text"
                placeholder="예: 라면 끓이는 방법에 대한 부분만"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </section>

      {templates.length > 0 ? (
        <section className="card">
          <div>
            <h2>테마</h2>
            <p className="hint" style={{ marginTop: 4 }}>
              결과 화면에서 언제든 바꿀 수 있어요. 지금 고르지 않아도 됩니다.
            </p>
          </div>
          <div className="row" style={{ gap: 16 }}>
            {templates.map((t) => (
              <div key={t.id} style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div className="hint">{t.description}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <label className="choice" htmlFor="rights" style={{ alignItems: 'flex-start' }}>
          <input
            id="rights"
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ fontWeight: 500 }}>이 콘텐츠를 사용할 권리가 있어요</span>
            <br />
            <span className="hint">다른 사람의 영상이나 글은 원작자의 허락이 필요할 수 있어요.</span>
          </span>
        </label>

        {error ? <div className="error">{error}</div> : null}

        <div className="row">
          <button type="button" className="btn" disabled={!ready || busy} onClick={start}>
            {busy ? '시작하는 중…' : '쇼츠 만들기'}
          </button>
          {!rights ? <span className="hint">권리 확인에 체크하면 시작할 수 있어요.</span> : null}
        </div>
      </section>
    </main>
  );
}
