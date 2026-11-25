/**
 * 가운데 미디어 밴드 (3단 구성의 2단).
 *
 * 세그먼트는 출력 시간 기준으로 이미 잘려 있으므로 여기서는 컷을 몰라도 된다.
 * 줌(punch-in)과 Ken Burns만 적용한다.
 */
import type { Asset, MediaSegment, ResolvedTimeline } from '@skycut/schema';
import { msToFrame } from '@skycut/core';
import React from 'react';
import { Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Placeholder } from './Placeholder.js';
import type { AssetUrlResolver } from './Short.js';
import { rectStyle, textStyle } from './units.js';
import { FONT_FAMILY } from './fonts.js';

interface Props {
  timeline: ResolvedTimeline;
  assets: Record<string, Asset>;
  resolveAssetUrl: AssetUrlResolver;
}

/** 강조 순간의 확대. 들어갔다 나오는 모양으로 보간한다. */
function useZoomScale(timeline: ResolvedTimeline): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let scale = 1;
  for (const z of timeline.zooms) {
    const from = msToFrame(z.outStartMs, fps);
    const to = msToFrame(z.outEndMs, fps);
    if (frame < from || frame > to) continue;
    const mid = from + (to - from) * 0.35;
    scale = Math.max(
      scale,
      frame <= mid
        ? interpolate(frame, [from, mid], [1, z.scale], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        : interpolate(frame, [mid, to], [z.scale, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    );
  }
  return scale;
}

const SegmentContent: React.FC<{
  segment: MediaSegment;
  asset?: Asset;
  width: number;
  height: number;
  durationInFrames: number;
  resolveAssetUrl: AssetUrlResolver;
}> = ({ segment, asset, width, height, durationInFrames, resolveAssetUrl }) => {
  const frame = useCurrentFrame();

  const kb = segment.kenBurns;
  const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
  const scale = kb ? interpolate(progress, [0, 1], [kb.scaleFrom, kb.scaleTo], { extrapolateRight: 'clamp' }) : 1;
  const panX = kb ? interpolate(progress, [0, 1], [0, kb.panXNorm * width], { extrapolateRight: 'clamp' }) : 0;

  const inner: React.ReactNode = (() => {
    if (!asset) {
      // 이미지가 없는 장면 → 큰 텍스트 카드
      return (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#15171c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: width * 0.08,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              fontFamily: FONT_FAMILY.title,
              fontSize: height * 0.19,
              color: '#ffffff',
              textAlign: 'center',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
            }}
          >
            {segment.textCard}
          </div>
        </div>
      );
    }
    const file = asset.variants[segment.variant] ?? asset.variants.source ?? asset.variants.proxy;
    if (file) {
      const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
      return asset.kind === 'video' ? (
        <OffthreadVideo src={resolveAssetUrl(file)} startFrom={0} style={fill} />
      ) : (
        <Img src={resolveAssetUrl(file)} style={fill} />
      );
    }
    if (asset.placeholder) {
      return <Placeholder spec={asset.placeholder} width={width} height={height} />;
    }
    return <div style={{ position: 'absolute', inset: 0, background: '#2a2d34' }} />;
  })();

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${scale}) translateX(${panX}px)` }}>{inner}</div>
      {asset && segment.textCard ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: height * 0.08,
            textAlign: 'center',
            fontFamily: FONT_FAMILY.title,
            fontSize: height * 0.14,
            color: '#ffffff',
          }}
        >
          {segment.textCard}
        </div>
      ) : null}
    </div>
  );
};

export const MediaBand: React.FC<Props> = ({ timeline, assets, resolveAssetUrl }) => {
  const { fps } = useVideoConfig();
  const frame = { width: timeline.width, height: timeline.height };
  const zoom = useZoomScale(timeline);

  const bandW = timeline.mediaRect.w * timeline.width;
  const bandH = timeline.mediaRect.h * timeline.height;

  return (
    <div
      style={{
        ...rectStyle(timeline.mediaRect, frame),
        overflow: 'hidden',
        borderRadius: timeline.mediaRadiusNorm * timeline.height,
        background: '#15171c',
        transform: `scale(${zoom})`,
      }}
    >
      {timeline.segments.map((seg, i) => {
        const from = msToFrame(seg.outStartMs, fps);
        const duration = Math.max(1, msToFrame(seg.outEndMs, fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            <SegmentContent
              segment={seg}
              asset={seg.assetId ? assets[seg.assetId] : undefined}
              width={bandW}
              height={bandH}
              durationInFrames={duration}
              resolveAssetUrl={resolveAssetUrl}
            />
          </Sequence>
        );
      })}
    </div>
  );
};

/** 자막은 미디어 위에 얹히지만 줌의 영향을 받으면 안 되므로 별도 레이어로 둔다. */
export const captionBoxStyle = (timeline: ResolvedTimeline) => {
  const frame = { width: timeline.width, height: timeline.height };
  return {
    ...rectStyle(timeline.captionLayout.rect, frame),
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    ...textStyle(timeline.captionLayout.style, frame),
  };
};
