/**
 * API는 **같은 출처로 프록시**한다.
 *
 * `NEXT_PUBLIC_*` 값은 빌드 시점에 번들에 박히므로, 한 번 빌드한 결과물을
 * 다른 포트의 API에 붙일 수 없다. rewrites는 서버가 뜰 때 읽으므로
 * 같은 빌드로 개발·테스트·운영 어디에나 붙일 수 있다.
 * 덤으로 브라우저는 한 출처만 보게 되어 CORS가 필요 없다.
 */
const API_ORIGIN = process.env.SKYCUT_API_ORIGIN ?? 'http://127.0.0.1:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 모노레포의 TS 소스를 그대로 가져다 쓴다 (빌드 단계를 하나 줄인다)
  transpilePackages: ['@skycut/schema', '@skycut/core', '@skycut/templates', '@skycut/renderer'],
  typescript: { ignoreBuildErrors: false },

  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/media/:path*', destination: `${API_ORIGIN}/media/:path*` },
      { source: '/downloads/:path*', destination: `${API_ORIGIN}/downloads/:path*` },
    ];
  },

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
