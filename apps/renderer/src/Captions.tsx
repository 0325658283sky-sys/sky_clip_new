/**
 * 자막. 1~3어절 묶음이 흰 굵은 글씨 + 검정 테두리로 나타난다.
 *   pop     : 작게 → 살짝 크게 → 원래 (테마 A)
 *   fade_up : 아래에서 떠오르며 서서히 (테마 B)
 */
import { msToFrame } from '@skycut/core';
import type { ResolvedCaption, ResolvedTimeline } from '@skycut/schema';
import React from 'react';
import { Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { rectStyle, textStyle } from './units.js';

const CaptionLine: React.FC<{ caption: ResolvedCaption; fontSize: number }> = ({ caption, fontSize }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const animFrames = Math.max(1, msToFrame(caption.animationMs, fps));

  let transform = 'none';
  let opacity = 1;

  if (caption.animation === 'pop') {
    const scale = interpolate(frame, [0, animFrames * 0.6, animFrames], [0.72, 1.08, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    opacity = interpolate(frame, [0, animFrames * 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    transform = `scale(${scale})`;
  } else if (caption.animation === 'fade_up') {
    const y = interpolate(frame, [0, animFrames], [fontSize * 0.22, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    opacity = interpolate(frame, [0, animFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    transform = `translateY(${y}px)`;
  }

  return (
    <div style={{ transform, opacity, transformOrigin: 'center bottom' }}>
      {caption.spans.map((s, i) => (
        <span key={i} style={{ color: s.color }}>
          {s.text}
        </span>
      ))}
    </div>
  );
};

export const Captions: React.FC<{ timeline: ResolvedTimeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const frame = { width: timeline.width, height: timeline.height };
  const layout = timeline.captionLayout;
  const fontSize = layout.style.fontSize * timeline.height;

  return (
    <div
      style={{
        ...rectStyle(layout.rect, frame),
        display: 'flex',
        alignItems: layout.anchor === 'media_bottom' ? 'flex-end' : 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div style={{ ...textStyle(layout.style, frame), width: '100%' }}>
        {timeline.captions.map((c, i) => {
          const from = msToFrame(c.outStartMs, fps);
          const duration = Math.max(1, msToFrame(c.outEndMs, fps) - from);
          return (
            <Sequence key={i} from={from} durationInFrames={duration} layout="none">
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                <CaptionLine caption={c} fontSize={fontSize} />
              </div>
            </Sequence>
          );
        })}
      </div>
    </div>
  );
};
