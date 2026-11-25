import type { Asset, ResolvedTimeline } from '@skycut/schema';
import React from 'react';
import { Composition } from 'remotion';
import { Short, type ShortProps } from './Short.js';
import samples from './samples.generated.json';

// Remotion의 Composition은 props가 Record<string, unknown>에 대입 가능하길 요구한다.
// 컴포넌트 안에서는 ShortProps로 엄격히 쓰고, 등록할 때만 넓힌다.
const ShortComponent = Short as unknown as React.FC<Record<string, unknown>>;

interface Sample {
  id: string;
  projectId: string;
  templateId: string;
  title: string;
  timeline: ResolvedTimeline;
  assets: Record<string, Asset>;
}

const SAMPLES = samples as unknown as Sample[];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {SAMPLES.map((s) => (
        <Composition
          key={s.id}
          id={s.id}
          component={ShortComponent}
          durationInFrames={s.timeline.durationInFrames}
          fps={s.timeline.fps}
          width={s.timeline.width}
          height={s.timeline.height}
          defaultProps={{ timeline: s.timeline, assets: s.assets } satisfies ShortProps as unknown as Record<string, unknown>}
        />
      ))}
    </>
  );
};
