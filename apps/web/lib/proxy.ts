/**
 * API 서버로 넘기는 프록시.
 *
 * `next.config.mjs`의 `rewrites`로 하면 **빌드 시점에** 주소가 결과물에 박힌다
 * (`.next/routes-manifest.json`). 그러면 한 번 빌드한 결과물을 다른 포트의
 * API에 붙일 수 없다. 여기서 환경 변수를 요청마다 읽어 그 문제를 없앤다.
 *
 * 브라우저는 웹 서버 한 곳만 보므로 CORS가 필요 없고, API를 바깥에
 * 열지 않아도 된다(`SKYCUT_API_HOST` 기본값은 127.0.0.1).
 */

function apiOrigin(): string {
  return process.env.SKYCUT_API_ORIGIN ?? 'http://127.0.0.1:4000';
}

/** 홉 단위 헤더는 넘기지 않는다. */
const DROP_FROM_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
]);

const DROP_FROM_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
]);

export async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = `${apiOrigin()}${url.pathname}${url.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_FROM_REQUEST.has(key)) headers.set(key, value);
  });
  // 압축 없이 받아야 content-length와 Range 응답을 그대로 넘길 수 있다
  headers.set('accept-encoding', 'identity');

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
    cache: 'no-store',
  };
  if (hasBody) {
    // 스트림을 그대로 흘려보낸다 — 업로드를 메모리에 담지 않는다
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { error: 'API 서버에 연결하지 못했어요. 서버가 떠 있는지 확인해 주세요.' },
      { status: 502 },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_FROM_RESPONSE.has(key)) out.set(key, value);
  });

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
