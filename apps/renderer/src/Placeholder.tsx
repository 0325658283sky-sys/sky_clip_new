/**
 * 실제 미디어가 없을 때 그리는 자리 표시 그림.
 *
 * M0 전용. M2부터 실제 영상·이미지 파일이 들어오면 <Video>/<Img>로 바뀐다.
 * 남의 영상 캡처를 쓰지 않기 위해 단순 도형으로만 그린다.
 */
import type { PlaceholderSpec } from '@skycut/schema';
import React from 'react';

interface Props {
  spec: PlaceholderSpec;
  width: number;
  height: number;
}

export const Placeholder: React.FC<Props> = ({ spec, width, height }) => {
  const p = spec.palette;
  const c = (i: number, fallback: string) => p[i] ?? fallback;

  const label = spec.label ? (
    <div
      style={{
        position: 'absolute',
        left: width * 0.018,
        top: height * 0.03,
        padding: `${height * 0.012}px ${width * 0.012}px`,
        borderRadius: height * 0.02,
        background: 'rgba(0,0,0,0.5)',
        color: '#ffffff',
        fontSize: height * 0.052,
        fontWeight: 700,
        letterSpacing: '-0.01em',
      }}
    >
      {spec.label}
    </div>
  ) : null;

  if (spec.kind === 'landscape') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: c(0, '#bfe0f2') }}>
        <div
          style={{
            position: 'absolute',
            right: width * 0.18,
            top: height * 0.13,
            width: height * 0.2,
            height: height * 0.2,
            borderRadius: '50%',
            background: c(1, '#ffd27a'),
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: -width * 0.11,
            bottom: -height * 0.3,
            width: width * 0.72,
            height: height * 0.69,
            borderRadius: '50%',
            background: c(2, '#7fb77e'),
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -width * 0.17,
            bottom: -height * 0.39,
            width: width * 0.83,
            height: height * 0.79,
            borderRadius: '50%',
            background: c(3, '#4f8f5b'),
          }}
        />
        {label}
      </div>
    );
  }

  // talk_scene: 두 사람이 마주 앉은 장면
  const skin = c(4, '#f1c9a5');
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: c(0, '#cdb99a') }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.28, background: c(1, '#8a6f52') }} />
      <div style={{ position: 'absolute', left: width * 0.256, top: height * 0.227, width: height * 0.207, height: height * 0.207, borderRadius: '50%', background: skin }} />
      <div style={{ position: 'absolute', left: width * 0.206, top: height * 0.443, width: width * 0.217, height: height * 0.473, borderRadius: `${height * 0.148}px ${height * 0.148}px ${height * 0.04}px ${height * 0.04}px`, background: c(2, '#3f5d7d') }} />
      <div style={{ position: 'absolute', left: width * 0.628, top: height * 0.246, width: height * 0.207, height: height * 0.207, borderRadius: '50%', background: skin }} />
      <div style={{ position: 'absolute', left: width * 0.578, top: height * 0.463, width: width * 0.217, height: height * 0.453, borderRadius: `${height * 0.148}px ${height * 0.148}px ${height * 0.04}px ${height * 0.04}px`, background: c(3, '#b4553f') }} />
      <div style={{ position: 'absolute', left: width * 0.1, right: width * 0.1, bottom: height * 0.167, height: height * 0.079, borderRadius: height * 0.02, background: '#4a3a2c' }} />
      {label}
    </div>
  );
};
