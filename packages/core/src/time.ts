/**
 * 원본 시간 ↔ 출력 시간 매핑.
 *
 * 저장되는 시간은 모두 원본 기준이고(ARCHITECTURE.md 규칙 2), 컷을 반영한
 * 출력 시간은 여기서만 계산한다. 프레임 변환도 여기 한 곳에서만 한다.
 */

export interface Range {
  startMs: number;
  endMs: number;
}

export interface TimeSegment {
  sourceStartMs: number;
  sourceEndMs: number;
  outStartMs: number;
  outEndMs: number;
}

export interface TimeMap {
  segments: TimeSegment[];
  durationMs: number;
  range: Range;
}

/** 겹치거나 맞닿은 구간을 합치고 정렬한다. */
export function normalizeRanges(ranges: readonly Range[]): Range[] {
  const valid = ranges
    .filter((r) => r.endMs > r.startMs)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: Range[] = [];
  for (const r of valid) {
    const last = out[out.length - 1];
    if (last && r.startMs <= last.endMs) {
      if (r.endMs > last.endMs) last.endMs = r.endMs;
    } else {
      out.push(r);
    }
  }
  return out;
}

/** 클립 범위에서 cuts를 뺀 나머지로 출력 타임라인을 만든다. */
export function buildTimeMap(range: Range, cuts: readonly Range[] = []): TimeMap {
  const start = range.startMs;
  const end = Math.max(range.startMs, range.endMs);

  const clipped = normalizeRanges(
    cuts
      .map((c) => ({ startMs: Math.max(c.startMs, start), endMs: Math.min(c.endMs, end) }))
      .filter((c) => c.endMs > c.startMs),
  );

  const segments: TimeSegment[] = [];
  let cursor = start;
  let out = 0;

  const push = (from: number, to: number) => {
    if (to <= from) return;
    segments.push({ sourceStartMs: from, sourceEndMs: to, outStartMs: out, outEndMs: out + (to - from) });
    out += to - from;
  };

  for (const cut of clipped) {
    push(cursor, cut.startMs);
    cursor = Math.max(cursor, cut.endMs);
  }
  push(cursor, end);

  return { segments, durationMs: out, range: { startMs: start, endMs: end } };
}

/**
 * 원본 시각 → 출력 시각. 삭제 구간 안이면 null.
 * `preferNext`: 경계에서 다음 세그먼트 시작으로 붙인다(구간 시작점용).
 */
export function toOutputMs(map: TimeMap, sourceMs: number, preferNext = false): number | null {
  for (const s of map.segments) {
    if (sourceMs >= s.sourceStartMs && sourceMs < s.sourceEndMs) {
      return s.outStartMs + (sourceMs - s.sourceStartMs);
    }
    if (sourceMs === s.sourceEndMs && !preferNext) {
      return s.outEndMs;
    }
    if (preferNext && sourceMs <= s.sourceStartMs) {
      return s.outStartMs;
    }
  }
  const last = map.segments[map.segments.length - 1];
  if (last && sourceMs >= last.sourceEndMs) return last.outEndMs;
  return null;
}

export interface OutRange {
  outStartMs: number;
  outEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
}

/**
 * 원본 구간 → 출력 구간 목록.
 * - 전부 삭제 구간 안이면 빈 배열
 * - 일부만 걸치면 남은 부분만
 * - 삭제 구간을 가로지르면 여러 조각으로 나뉜다
 */
export function mapRange(map: TimeMap, startMs: number, endMs: number): OutRange[] {
  const out: OutRange[] = [];
  if (endMs <= startMs) return out;
  for (const s of map.segments) {
    const from = Math.max(startMs, s.sourceStartMs);
    const to = Math.min(endMs, s.sourceEndMs);
    if (to <= from) continue;
    out.push({
      outStartMs: s.outStartMs + (from - s.sourceStartMs),
      outEndMs: s.outStartMs + (to - s.sourceStartMs),
      sourceStartMs: from,
      sourceEndMs: to,
    });
  }
  return out;
}

/** 조각난 출력 구간을 하나로 합친다 (자막처럼 끊기면 안 되는 요소용). */
export function mergeOutRanges(ranges: readonly OutRange[]): OutRange | null {
  if (ranges.length === 0) return null;
  const first = ranges[0]!;
  const last = ranges[ranges.length - 1]!;
  return {
    outStartMs: first.outStartMs,
    outEndMs: last.outEndMs,
    sourceStartMs: first.sourceStartMs,
    sourceEndMs: last.sourceEndMs,
  };
}

/** ms → 프레임. 반올림 규칙을 한 곳에 모은다. */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

export function frameToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

/** 길이를 프레임으로. 최소 1프레임. */
export function durationToFrames(ms: number, fps: number): number {
  return Math.max(1, Math.round((ms / 1000) * fps));
}
