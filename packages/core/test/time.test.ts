import { describe, expect, it } from 'vitest';
import { buildTimeMap, mapRange, mergeOutRanges, normalizeRanges, toOutputMs, durationToFrames } from '../src/time.js';

describe('normalizeRanges', () => {
  it('겹치는 구간을 합친다', () => {
    expect(normalizeRanges([{ startMs: 100, endMs: 300 }, { startMs: 250, endMs: 400 }])).toEqual([
      { startMs: 100, endMs: 400 },
    ]);
  });

  it('길이 0인 구간은 버린다', () => {
    expect(normalizeRanges([{ startMs: 100, endMs: 100 }])).toEqual([]);
  });
});

describe('buildTimeMap', () => {
  it('컷이 없으면 구간 하나', () => {
    const m = buildTimeMap({ startMs: 1000, endMs: 5000 });
    expect(m.segments).toHaveLength(1);
    expect(m.durationMs).toBe(4000);
    expect(m.segments[0]).toMatchObject({ sourceStartMs: 1000, outStartMs: 0, outEndMs: 4000 });
  });

  it('가운데를 자르면 두 구간이 되고 길이가 줄어든다', () => {
    const m = buildTimeMap({ startMs: 0, endMs: 10_000 }, [{ startMs: 3000, endMs: 5000 }]);
    expect(m.segments).toHaveLength(2);
    expect(m.durationMs).toBe(8000);
    expect(m.segments[1]).toMatchObject({ sourceStartMs: 5000, outStartMs: 3000, outEndMs: 8000 });
  });

  it('클립 범위 밖의 컷은 무시한다', () => {
    const m = buildTimeMap({ startMs: 2000, endMs: 6000 }, [{ startMs: 0, endMs: 1000 }]);
    expect(m.durationMs).toBe(4000);
  });
});

describe('toOutputMs', () => {
  const m = buildTimeMap({ startMs: 0, endMs: 10_000 }, [{ startMs: 3000, endMs: 5000 }]);

  it('컷 이전은 그대로', () => {
    expect(toOutputMs(m, 1000)).toBe(1000);
  });

  it('컷 이후는 당겨진다', () => {
    expect(toOutputMs(m, 6000)).toBe(4000);
  });

  it('삭제 구간 안이면 null', () => {
    expect(toOutputMs(m, 4000)).toBeNull();
  });
});

describe('mapRange', () => {
  const m = buildTimeMap({ startMs: 0, endMs: 10_000 }, [{ startMs: 3000, endMs: 5000 }]);

  it('전부 삭제 구간 안이면 빈 배열', () => {
    expect(mapRange(m, 3200, 4800)).toEqual([]);
  });

  it('일부만 걸치면 남은 부분만 남는다', () => {
    const r = mapRange(m, 2000, 4000);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ outStartMs: 2000, outEndMs: 3000 });
  });

  it('삭제 구간을 가로지르면 조각으로 나뉜다', () => {
    const r = mapRange(m, 2000, 6000);
    expect(r).toHaveLength(2);
    expect(mergeOutRanges(r)).toMatchObject({ outStartMs: 2000, outEndMs: 4000 });
  });
});

describe('durationToFrames', () => {
  it('30fps에서 1초는 30프레임', () => {
    expect(durationToFrames(1000, 30)).toBe(30);
  });

  it('0ms여도 최소 1프레임', () => {
    expect(durationToFrames(0, 30)).toBe(1);
  });
});
