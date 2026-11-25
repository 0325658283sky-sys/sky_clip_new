import type { Rect, TextStyle } from '@skycut/schema';
import type { CSSProperties } from 'react';
import { FONT_FAMILY } from './fonts.js';

export interface Frame {
  width: number;
  height: number;
}

/** 정규화 사각형 → 픽셀 absolute 스타일 */
export function rectStyle(rect: Rect, frame: Frame): CSSProperties {
  return {
    position: 'absolute',
    left: rect.x * frame.width,
    top: rect.y * frame.height,
    width: rect.w * frame.width,
    height: rect.h * frame.height,
  };
}

/**
 * TextStyle → CSS.
 * fontSize는 프레임 높이 대비 비율이므로 해상도가 바뀌어도 같은 모양이 된다.
 */
export function textStyle(style: TextStyle, frame: Frame): CSSProperties {
  const fontSize = style.fontSize * frame.height;
  const css: CSSProperties = {
    fontFamily: FONT_FAMILY[style.fontFamily],
    fontWeight: style.fontWeight,
    fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacingEm}em`,
    color: style.color,
    textAlign: style.align,
    margin: 0,
    whiteSpace: 'pre-wrap',
  };
  if (style.stroke.widthEm > 0) {
    // paintOrder를 주면 외곽선이 글자 안쪽을 파먹지 않는다
    css.WebkitTextStrokeWidth = style.stroke.widthEm * fontSize;
    css.WebkitTextStrokeColor = style.stroke.color;
    css.paintOrder = 'stroke fill';
  }
  return css;
}

export function justifyFor(align: TextStyle['align']): CSSProperties['justifyContent'] {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
}
