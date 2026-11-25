/**
 * API는 **같은 출처로 프록시**한다. 브라우저는 웹 서버 한 곳만 보므로
 * CORS가 필요 없고, API를 바깥에 열지 않아도 된다.
 *
 * 프록시는 `rewrites`가 아니라 라우트 핸들러(`app/api/[...path]/route.ts`)로
 * 한다. `rewrites`의 destination은 빌드 시점에 결과물에 박혀서, 한 번 빌드한
 * 것을 다른 포트의 API에 붙일 수 없다. 라우트 핸들러는 요청마다
 * `SKYCUT_API_ORIGIN`을 읽으므로 같은 빌드를 개발·테스트·운영에 다 쓴다.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 모노레포의 TS 소스를 그대로 가져다 쓴다 (빌드 단계를 하나 줄인다)
  transpilePackages: ['@skycut/schema', '@skycut/core', '@skycut/templates', '@skycut/renderer'],
  typescript: { ignoreBuildErrors: false },

  // 진행률(SSE)을 압축하면 버퍼에 쌓여 실시간이 아니게 된다. 운영에서는
  // 앞단 프록시가 압축을 맡는다.
  compress: false,

  // Next 16은 Turbopack이 기본이지만, 모노레포 패키지의 `./x.js` import를 풀려면
  // extensionAlias가 필요해 webpack으로 돌린다 (--webpack 플래그와 짝).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
