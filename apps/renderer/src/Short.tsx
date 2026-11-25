/**
 * 쇼츠 한 편. ResolvedTimeline 하나만 받아 그린다.
 *
 * 미리보기(@remotion/player)와 서버 렌더가 이 컴포넌트를 공유하므로
 * 둘의 결과가 어긋날 수 없다 (ARCHITECTURE.md 규칙: Remotion 단일 엔진).
 */
import type { Asset, ResolvedTimeline } from '@skycut/schema';
import { msToFrame } from '@skycut/core';
import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { Captions } from './Captions.js';
import { MediaBand } from './MediaBand.js';
import { Overlays, TitleBlock } from './Overlays.js';
import { Placeholder } from './Placeholder.js';

export interface ShortProps {
  timeline: ResolvedTimeline;
  assets: Record<string, Asset>;
}

/** 배경: 단색이거나, 미디어를 크게 흐려 깐 것 */
const Background: React.FC<ShortProps> = ({ timeline, assets }) => {
  const bg = timeline.background;
  if (bg.kind === 'solid') return <AbsoluteFill style={{ background: bg.color }} />;

  const first = timeline.segments[0];
  const asset = first?.assetId ? assets[first.assetId] : undefined;
  return (
    <AbsoluteFill style={{ background: bg.fallbackColor, overflow: 'hidden' }}>
      {asset?.placeholder ? (
        <AbsoluteFill style={{ filter: `blur(${bg.blurPx}px)`, transform: 'scale(1.3)' }}>
          <Placeholder spec={asset.placeholder} width={timeline.width} height={timeline.height} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ background: `rgba(0,0,0,${bg.dim})` }} />
    </AbsoluteFill>
  );
};

/**
 * 오디오.
 * 덕킹은 resolve()가 구간을 계산해 주고, 여기서는 그 구간에서 볼륨을 낮춘다.
 * M0 샘플에는 실제 음원 파일이 없어 아무것도 재생되지 않는다.
 */
const AudioTracks: React.FC<ShortProps> = ({ timeline, assets }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {timeline.audio.map((track, i) => {
        if (!track.assetId) return null;
        const asset = assets[track.assetId];
        const file = asset?.variants.source ?? asset?.variants.proxy;
        if (!file) return null; // 자리 표시 에셋에는 음원이 없다

        const from = msToFrame(track.outStartMs, fps);
        const duration = Math.max(1, msToFrame(track.outEndMs, fps) - from);
        const base = dbToGain(track.gainDb);
        const ducked = dbToGain(track.gainDb + track.duckingDb);

        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            <Audio
              src={staticFile(file)}
              startFrom={msToFrame(track.sourceStartMs, fps)}
              volume={(f) => {
                const atMs = (f / fps) * 1000 + track.outStartMs;
                const inDuck = track.duckRanges.some((d) => atMs >= d.outStartMs && atMs < d.outEndMs);
                return inDuck ? ducked : base;
              }}
            />
          </Sequence>
        );
      })}
    </>
  );
};

function dbToGain(db: number): number {
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}

export const Short: React.FC<ShortProps> = ({ timeline, assets }) => {
  return (
    <AbsoluteFill style={{ background: '#000000' }}>
      <Background timeline={timeline} assets={assets} />
      <MediaBand timeline={timeline} assets={assets} />
      <Captions timeline={timeline} />
      <TitleBlock timeline={timeline} />
      <Overlays timeline={timeline} />
      <AudioTracks timeline={timeline} assets={assets} />
    </AbsoluteFill>
  );
};
