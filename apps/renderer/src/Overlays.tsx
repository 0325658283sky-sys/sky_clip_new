/** 제목, 프로필 헤더, 하단 카드, 출처, 효과 글자. */
import { msToFrame } from '@skycut/core';
import type { ResolvedOverlay, ResolvedTimeline } from '@skycut/schema';
import React from 'react';
import { Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { justifyFor, rectStyle, textStyle, type Frame } from './units.js';

export const TitleBlock: React.FC<{ timeline: ResolvedTimeline }> = ({ timeline }) => {
  const title = timeline.title;
  if (!title) return null;
  const frame: Frame = { width: timeline.width, height: timeline.height };
  return (
    <div
      style={{
        ...rectStyle(title.rect, frame),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
      }}
    >
      <div style={textStyle(title.style, frame)}>
        {title.lines.map((line, i) => (
          <div key={i}>
            {line.map((span, j) => (
              <span key={j} style={{ color: span.color }}>
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const ProfileHeader: React.FC<{ o: Extract<ResolvedOverlay, { kind: 'profile_header' }>; frame: Frame }> = ({ o, frame }) => {
  const size = o.rect.h * frame.height;
  return (
    <div style={{ ...rectStyle(o.rect, frame), display: 'flex', alignItems: 'center', gap: size * 0.22 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: o.avatarBg,
          color: o.avatarFg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.46,
          fontWeight: 900,
          flexShrink: 0,
        }}
      >
        {o.initial}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={textStyle(o.nameStyle, frame)}>{o.name}</div>
        {o.handle ? <div style={textStyle(o.handleStyle, frame)}>{o.handle}</div> : null}
      </div>
    </div>
  );
};

const BottomCard: React.FC<{ o: Extract<ResolvedOverlay, { kind: 'bottom_card' }>; frame: Frame }> = ({ o, frame }) => {
  const pad = o.rect.h * frame.height * 0.18;
  const isCard = o.shape === 'card';
  return (
    <div
      style={{
        ...rectStyle(o.rect, frame),
        background: isCard ? o.bg : 'transparent',
        borderRadius: o.radiusNorm * frame.height,
        padding: isCard ? `${pad}px ${pad * 1.2}px` : 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: pad * 0.3,
        justifyContent: 'center',
        alignItems: isCard ? 'stretch' : 'center',
      }}
    >
      {o.label && o.labelStyle ? <div style={textStyle(o.labelStyle, frame)}>{o.label}</div> : null}
      <div style={{ ...textStyle(o.textStyle, frame), display: 'flex', justifyContent: justifyFor(o.textStyle.align) }}>
        {o.text}
      </div>
    </div>
  );
};

const EffectText: React.FC<{ o: Extract<ResolvedOverlay, { kind: 'effect_text' }>; frame: Frame }> = ({ o, frame }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anim = Math.max(1, msToFrame(260, fps));
  const total = Math.max(1, msToFrame(o.outEndMs - o.outStartMs, fps));
  const scale = interpolate(f, [0, anim * 0.55, anim], [0.3, 1.2, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = interpolate(f, [0, anim * 0.4, total - anim * 0.6, total], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        ...rectStyle(o.rect, frame),
        display: 'flex',
        alignItems: 'center',
        justifyContent: justifyFor(o.style.align),
        transform: `rotate(${o.rotateDeg}deg) scale(${scale})`,
        opacity,
      }}
    >
      <div style={textStyle(o.style, frame)}>{o.text}</div>
    </div>
  );
};

export const Overlays: React.FC<{ timeline: ResolvedTimeline }> = ({ timeline }) => {
  const { fps } = useVideoConfig();
  const frame: Frame = { width: timeline.width, height: timeline.height };

  return (
    <>
      {timeline.overlays.map((o, i) => {
        if (o.kind === 'profile_header') return <ProfileHeader key={i} o={o} frame={frame} />;
        if (o.kind === 'bottom_card') return <BottomCard key={i} o={o} frame={frame} />;
        if (o.kind === 'credit') {
          return (
            <div
              key={i}
              style={{ ...rectStyle(o.rect, frame), display: 'flex', alignItems: 'center', justifyContent: justifyFor(o.style.align) }}
            >
              <div style={textStyle(o.style, frame)}>{o.text}</div>
            </div>
          );
        }
        const from = msToFrame(o.outStartMs, fps);
        const duration = Math.max(1, msToFrame(o.outEndMs, fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            <EffectText o={o} frame={frame} />
          </Sequence>
        );
      })}
    </>
  );
};
