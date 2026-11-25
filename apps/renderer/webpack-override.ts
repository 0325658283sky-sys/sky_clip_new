/**
 * Remotion(webpack)이 모노레포 TS 소스를 그대로 읽게 한다.
 *
 * 1) `./x.js` 형태의 import를 `.ts`/`.tsx`로 풀어 준다 (ESM 규칙을 지키면서 TS를 쓰기 위함)
 * 2) node_modules에 심볼릭 링크된 워크스페이스 패키지(@skycut/*)의 TS도 변환 대상에 넣는다
 */
import type { WebpackOverrideFn } from '@remotion/bundler';

export const enableSkycutResolution: WebpackOverrideFn = (config) => {
  const resolve = config.resolve ?? {};
  const extensionAlias = {
    ...(resolve as { extensionAlias?: Record<string, string[]> }).extensionAlias,
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
  };

  return {
    ...config,
    resolve: {
      ...resolve,
      extensionAlias,
      symlinks: false,
    },
  };
};
