/**
 * 한국어 자막 묶기와 줄나눔.
 *
 * 국내 표본에서 자막은 "1~3어절씩, 흰 굵은 글씨 + 검정 테두리"가 표준이었다.
 * (research/쇼츠_트렌드_조사.md §7.2)
 */

export interface TimedWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionGroup {
  words: TimedWord[];
  text: string;
  startMs: number;
  endMs: number;
}

export interface GroupingRule {
  maxChars: number;
  maxWords: number;
  minDurationMs: number;
}

/** 한국어 조사·어미만 남은 짧은 꼬리 (줄 끝에 혼자 두지 않는다) */
const ORPHAN_TAIL = /^(은|는|이|가|을|를|에|의|도|만|와|과|로|으로|에서|에게|부터|까지|라고|이라고)$/;

/** 단어를 1~maxWords 어절 묶음으로 나눈다. 문장 경계를 넘지 않는다. */
export function groupWords(
  words: readonly TimedWord[],
  rule: GroupingRule,
  sentenceBreakAfter: ReadonlySet<string> = new Set(),
): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    groups.push({
      words: current,
      text: current.map((w) => w.text).join(' '),
      startMs: first.startMs,
      endMs: Math.max(last.endMs, first.startMs + rule.minDurationMs),
    });
    current = [];
  };

  for (const w of words) {
    const nextChars = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    const tooLong = current.length > 0 && (nextChars > rule.maxChars || current.length >= rule.maxWords);
    // 조사만 남은 꼬리는 앞 묶음에 붙인다
    if (tooLong && !ORPHAN_TAIL.test(w.text)) flush();
    current.push(w);
    if (sentenceBreakAfter.has(w.id)) flush();
  }
  flush();

  // 묶음이 서로 겹치지 않도록 끝 시각을 다음 묶음 시작으로 자른다
  for (let i = 0; i < groups.length - 1; i++) {
    const g = groups[i]!;
    const next = groups[i + 1]!;
    if (g.endMs > next.startMs) g.endMs = next.startMs;
    if (g.endMs <= g.startMs) g.endMs = g.startMs + 1;
  }
  return groups;
}

/**
 * 어절 단위 줄나눔. 조사 단독 줄을 만들지 않는다.
 * maxLines를 넘으면 마지막 줄에 몰아 넣는다(잘라내지 않는다).
 */
export function wrapKorean(text: string, maxChars: number, maxLines = 2): string[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    const candidate = line ? `${line} ${t}` : t;
    if (line && candidate.length > maxChars && lines.length < maxLines - 1 && !ORPHAN_TAIL.test(t)) {
      lines.push(line);
      line = t;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** 나레이션 대본을 TTS 단어 타이밍에 맞춰 TimedWord로 바꾼다. */
export function timingsToWords(
  timings: readonly { text: string; startMs: number; endMs: number }[],
  idPrefix: string,
  offsetMs = 0,
): TimedWord[] {
  return timings.map((t, i) => ({
    id: `${idPrefix}-${i}`,
    text: t.text,
    startMs: t.startMs + offsetMs,
    endMs: t.endMs + offsetMs,
  }));
}
