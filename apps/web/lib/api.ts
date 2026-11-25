/** API 서버와 이야기하는 곳. 화면 코드가 fetch를 직접 부르지 않게 모은다. */

/**
 * 같은 출처로 부른다. Next가 /api, /media, /downloads 를 API 서버로 넘긴다
 * (apps/web/next.config.mjs). 빌드 결과물이 특정 포트에 묶이지 않는다.
 */
export const API_BASE = '';

export interface JobProgress {
  stage: string;
  label: string;
  pct: number;
}

export interface JobView {
  id: string;
  kind: 'analyze' | 'render';
  state: 'queued' | 'running' | 'done' | 'failed' | 'canceled';
  progress: JobProgress;
  error?: { reason: string; message: string };
  retryable: boolean;
  result?: Record<string, unknown>;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  suitedFor: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `요청이 실패했어요 (HTTP ${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export function health(): Promise<{ ok: boolean; offline: boolean; templates: TemplateInfo[] }> {
  return request('/api/health');
}

export interface StartOptions {
  source: string;
  rightsAttested: boolean;
  genre?: string;
  prompt?: string;
  minSec?: number;
  maxSec?: number;
  maxClips?: number;
}

export function startFromLink(options: StartOptions): Promise<JobView> {
  return request('/api/projects', { method: 'POST', body: JSON.stringify(options) });
}

export async function startFromFile(file: File, genre?: string): Promise<JobView> {
  const form = new FormData();
  form.append('rightsAttested', 'true');
  if (genre) form.append('genre', genre);
  form.append('file', file);
  const response = await fetch(`${API_BASE}/api/projects/upload`, { method: 'POST', body: form });
  const body = (await response.json()) as JobView & { error?: string };
  if (!response.ok) throw new Error(body.error ?? '업로드에 실패했어요.');
  return body;
}

export function getJob(id: string): Promise<JobView> {
  return request(`/api/jobs/${id}`);
}

export function retryJob(id: string): Promise<JobView> {
  return request(`/api/jobs/${id}/retry`, { method: 'POST' });
}

export function getProject(id: string): Promise<unknown> {
  return request(`/api/projects/${id}`);
}

export function requestRender(
  projectId: string,
  clipId: string,
  body: { templateId?: string; titleIndex?: number },
): Promise<JobView> {
  return request(`/api/projects/${projectId}/clips/${clipId}/render`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** 진행률 구독. 돌려주는 함수를 부르면 끊는다. */
export function watchJob(id: string, onUpdate: (job: JobView) => void): () => void {
  const source = new EventSource(`${API_BASE}/api/jobs/${id}/events`);
  source.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data) as JobView);
    } catch {
      // 깨진 줄은 건너뛴다
    }
  };
  // 연결이 끊겨도 EventSource가 알아서 다시 붙는다. 끝난 작업이면 서버가 닫는다.
  return () => source.close();
}

/** 에셋 저장소 키 → 미리보기에서 쓸 주소 */
export function mediaUrl(storageKey: string): string {
  return `${API_BASE}/media/${storageKey}`;
}

export function downloadUrl(path: string): string {
  return `${API_BASE}${path}`;
}
