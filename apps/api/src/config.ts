import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(join(here, '..', '..', '..'));

export const PORT = Number(process.env.SKYCUT_API_PORT ?? 4000);
export const HOST = process.env.SKYCUT_API_HOST ?? '127.0.0.1';

/** 에셋 저장소. 워커가 쓰고, 여기서 정적으로 내보내고, 렌더러가 공개 폴더로 쓴다. */
export const MEDIA_DIR = resolve(process.env.SKYCUT_MEDIA_DIR ?? join(ROOT, 'out', 'media'));
/** 프로젝트 JSON과 작업 상태 */
export const DATA_DIR = resolve(process.env.SKYCUT_DATA_DIR ?? join(ROOT, 'out', 'api'));
export const PROJECT_DIR = join(DATA_DIR, 'projects');
export const JOB_DIR = join(DATA_DIR, 'jobs');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
/** 완성된 쇼츠 MP4 */
export const DOWNLOAD_DIR = resolve(process.env.SKYCUT_DOWNLOAD_DIR ?? join(ROOT, 'out', 'shorts'));

export const PYTHON = process.env.SKYCUT_PYTHON
  ?? join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const WORKER_DIR = join(ROOT, 'apps', 'worker');

/** 키가 없을 때 스텁으로 돌릴지. 개발 중에만 켠다. */
export const OFFLINE = process.env.SKYCUT_OFFLINE === '1';
export const STT_ENGINE = process.env.SKYCUT_STT_ENGINE ?? (OFFLINE ? 'stub' : 'elevenlabs');
export const TTS_PROVIDER = process.env.SKYCUT_TTS_PROVIDER ?? (OFFLINE ? 'stub' : 'elevenlabs');

/** 동시에 돌릴 작업 수. 분석과 렌더 모두 CPU를 많이 쓴다. */
export const CONCURRENCY = Number(process.env.SKYCUT_CONCURRENCY ?? 2);
/** 이 시간이 지난 업로드·결과물은 정리한다 */
export const RETENTION_HOURS = Number(process.env.SKYCUT_RETENTION_HOURS ?? 48);
/** 업로드 상한 */
export const MAX_UPLOAD_BYTES = Number(process.env.SKYCUT_MAX_UPLOAD_BYTES ?? 2 * 1024 * 1024 * 1024);
