/**
 * M0 샘플 Project JSON 4개를 만든다 (영상 2, 블로그 2).
 *
 * 실제 분석 엔진(M1~)이 없으므로 손으로 만든 값이다.
 * 미디어는 실제 파일 대신 placeholder로 그린다.
 *   npm run fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Project, SCHEMA_VERSION, type Asset, type Word } from '@skycut/schema';

const OUT = join(process.cwd(), 'fixtures');
mkdirSync(OUT, { recursive: true });

const CREATED_AT = '2026-11-25T00:00:00Z';

/** 어절마다 길이에 비례한 시간을 준다. 결정적이어야 하므로 난수를 쓰지 않는다. */
function makeWords(script: string, startMs: number, msPerChar = 125, gapMs = 60): Word[] {
  const words: Word[] = [];
  let cursor = startMs;
  let i = 0;
  for (const token of script.trim().split(/\s+/)) {
    const dur = Math.max(200, token.replace(/[.,!?]/g, '').length * msPerChar);
    words.push({ id: `w${i}`, text: token, startMs: cursor, endMs: cursor + dur, speakerId: 's1' });
    cursor += dur + gapMs;
    i++;
  }
  return words;
}

function videoAsset(id: string, palette: string[], label: string): Asset {
  return {
    id,
    kind: 'video',
    variants: {},
    width: 1920,
    height: 1080,
    placeholder: { kind: 'talk_scene', palette, label },
  };
}

function imageAsset(id: string, palette: string[], label: string): Asset {
  return {
    id,
    kind: 'image',
    variants: {},
    width: 1600,
    height: 900,
    placeholder: { kind: 'landscape', palette, label },
  };
}

/* ───────────────── 영상 1: 라면 꿀팁 (토크) ───────────────── */

const ramenScript =
  '자취 십 년 하면서 제일 많이 들은 질문이 라면 물 얼마나 넣냐는 거였는데요 ' +
  '정답은 종이컵 세 컵입니다 그리고 스프를 처음부터 다 넣지 마세요 ' +
  '반만 먼저 넣고 끓인 다음에 불 끄기 직전에 나머지를 넣으면 ' +
  '향이 안 날아가서 가게에서 먹는 맛이 납니다';

const ramenWords = makeWords(ramenScript, 124_500);

const videoRamen = {
  schemaVersion: SCHEMA_VERSION,
  id: 'fx-video-ramen',
  createdAt: CREATED_AT,
  input: { kind: 'youtube' as const, url: 'https://www.youtube.com/watch?v=EXAMPLE1', rightsAttested: true, attestedAt: CREATED_AT },
  sourceAssetId: 'src-ramen',
  assets: { 'src-ramen': videoAsset('src-ramen', ['#cdb99a', '#8a6f52', '#3f5d7d', '#b4553f', '#f1c9a5'], '원본 영상 16:9 (자리 표시)') },
  transcript: {
    words: ramenWords,
    sentences: [
      { id: 's1', startWordId: 'w0', endWordId: 'w14' },
      { id: 's2', startWordId: 'w15', endWordId: 'w24' },
      { id: 's3', startWordId: 'w25', endWordId: String(`w${ramenWords.length - 1}`) },
    ],
  },
  clips: [
    {
      id: 'c1',
      appliedTemplateId: 'a-black',
      selectedTitleIndex: 0,
      content: {
        kind: 'video_excerpt' as const,
        range: { startWordId: 'w0', endWordId: `w${ramenWords.length - 1}` },
        scenes: [],
        titles: [
          { line1: '자취 10년 차의', line2: '라면 황금 비율', keywordSpan: { start: 3, end: 7 } },
          { line1: '99%가 모르는', line2: '라면 물 맞추기', keywordSpan: { start: 3, end: 7 } },
          { line1: '이렇게 끓이면', line2: '가게 맛 납니다', keywordSpan: { start: 0, end: 4 } },
        ],
        bottomCard: { kind: 'summary' as const, text: '물은 종이컵 3컵, 스프는 반씩 나눠서' },
        effectMoments: [{ anchorWordId: 'w17', text: '오호?' }],
        autoEdit: { fillerWordIds: [], silenceRangesMs: [] },
        score: { total: 4.6, hook: 4.5, standalone: 4.8, ending: 4.7, value: 4.4 },
        reason: '첫 3초에 구체적인 질문이 나오고, 비율을 말하는 순간 깔끔하게 끝난다.',
        credit: { channelName: '예시 채널', videoTitle: '자취요리 EP.12' },
      },
      overrides: { content: { cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [] }, style: {}, keepStyleOnTemplateChange: false },
      generated: [],
    },
  ],
  provenance: { llmModel: 'fixture', promptVersion: 'm0-hand' },
};

/* ───────────── 영상 2: 예능 (군더더기 말 + 컷 + 효과) ───────────── */

const varietyScript =
  '어 잠깐만요 어 그러니까 규칙에 그런 말은 없었잖아요 ' +
  '음 저는 분명히 한 번만 바꾼다고 들었는데 ' +
  '그러면 형이 아까 두 번 바꾼 건 뭔데요';

const varietyWords = makeWords(varietyScript, 61_000);
const fillerIds = varietyWords.filter((w) => ['어', '음', '그러니까'].includes(w.text)).map((w) => w.id);

const videoVariety = {
  schemaVersion: SCHEMA_VERSION,
  id: 'fx-video-variety',
  createdAt: CREATED_AT,
  input: { kind: 'youtube' as const, url: 'https://www.youtube.com/watch?v=EXAMPLE2', rightsAttested: true, attestedAt: CREATED_AT },
  sourceAssetId: 'src-variety',
  assets: { 'src-variety': videoAsset('src-variety', ['#e3b3bd', '#9b5f6c', '#2e2e3a', '#d98f2b', '#f3cdb0'], '원본 영상 16:9 (자리 표시)') },
  transcript: { words: varietyWords, sentences: [] },
  clips: [
    {
      id: 'c1',
      appliedTemplateId: 'a-black',
      selectedTitleIndex: 0,
      content: {
        kind: 'video_excerpt' as const,
        range: { startWordId: 'w0', endWordId: `w${varietyWords.length - 1}` },
        scenes: [],
        titles: [
          { line1: '형 이건 좀', line2: '선 넘었다', keywordSpan: { start: 0, end: 4 } },
          { line1: '막내의', line2: '규칙 반격', keywordSpan: { start: 0, end: 5 } },
          { line1: '벌칙 피하려다', line2: '역관광', keywordSpan: { start: 0, end: 3 } },
        ],
        bottomCard: { kind: 'real_comment' as const, text: '막내가 제일 똑똑한 듯 ㅋㅋㅋ', authorMasked: '시청자 ○○○' },
        effectMoments: [
          { anchorWordId: varietyWords[8]?.id ?? 'w8', text: 'ㅋㅋㅋ' },
          { anchorWordId: varietyWords[varietyWords.length - 3]?.id ?? 'w20', text: '헉' },
        ],
        // 군더더기 말 자동 삭제 후보. 실제 삭제 여부는 템플릿 규칙이 정한다.
        autoEdit: { fillerWordIds: fillerIds, silenceRangesMs: [] },
        score: { total: 4.1, hook: 4.4, standalone: 3.9, ending: 4.2, value: 3.9 },
        reason: '웃음이 터지는 반응까지 포함해서 끝맺음이 살아 있다.',
        credit: { channelName: '예시 채널', videoTitle: '주말 예능 EP.21' },
      },
      overrides: { content: { cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [] }, style: {}, keepStyleOnTemplateChange: false },
      generated: [],
    },
  ],
  provenance: { llmModel: 'fixture', promptVersion: 'm0-hand' },
};

/* ───────────── 블로그 1: 이미지 3장 (나레이션) ───────────── */

function ttsFor(sceneId: string, narration: string, startOffset = 0) {
  const tokens = narration.trim().split(/\s+/);
  let cursor = startOffset;
  const wordTimings = tokens.map((t) => {
    const dur = Math.max(220, t.length * 135);
    const w = { text: t, startMs: cursor, endMs: cursor + dur };
    cursor += dur + 50;
    return w;
  });
  return {
    kind: 'tts' as const,
    assetId: `tts-${sceneId}`,
    cacheKey: `fixture-${sceneId}`,
    sceneId,
    wordTimings,
    durationMs: cursor + 250,
  };
}

const blogScenes = [
  { id: 'sc1', narration: '주말에 멀리 가긴 부담될 때 있죠', imageAssetId: 'img-1' },
  { id: 'sc2', narration: '지하철로 한 시간이면 가는 곳 세 군데만 알려드릴게요', imageAssetId: 'img-2' },
  { id: 'sc3', narration: '첫 번째는 강변 산책길 입구에서 바로 이어지는 코스예요', imageAssetId: 'img-3' },
];

const blogWalk = {
  schemaVersion: SCHEMA_VERSION,
  id: 'fx-blog-walk',
  createdAt: CREATED_AT,
  input: { kind: 'blog' as const, url: 'https://blog.naver.com/weekend-walk/1234567890', rightsAttested: true, attestedAt: CREATED_AT },
  assets: {
    'img-1': imageAsset('img-1', ['#bfe0f2', '#ffd27a', '#7fb77e', '#4f8f5b'], '블로그 이미지 1/3 (자리 표시)'),
    'img-2': imageAsset('img-2', ['#f6d6b8', '#ff9f6e', '#c99a6b', '#8c6a4a'], '블로그 이미지 2/3 (자리 표시)'),
    'img-3': imageAsset('img-3', ['#cfd8f5', '#ffffff', '#8aa0c8', '#5a6f99'], '블로그 이미지 3/3 (자리 표시)'),
  },
  article: {
    title: '주말 당일치기로 다녀온 근교 산책 코스 3곳',
    blogName: '주말 산책 기록',
    author: '산책러',
    sections: [],
  },
  clips: [
    {
      id: 'c1',
      appliedTemplateId: 'b-white',
      selectedTitleIndex: 0,
      content: {
        kind: 'narrated_story' as const,
        scenes: blogScenes,
        titles: [
          { line1: '주말 당일치기,', line2: '딱 3곳만 기억하세요', keywordSpan: { start: 2, end: 4 } },
          { line1: '지하철 1시간이면', line2: '가는 산책 코스', keywordSpan: { start: 3, end: 8 } },
          { line1: '멀리 가기 싫은 날', line2: '근교 어때요?', keywordSpan: { start: 0, end: 2 } },
        ],
        bottomCard: { kind: 'question' as const, text: '여러분의 당일치기 장소는?' },
        effectMoments: [],
        autoEdit: { fillerWordIds: [], silenceRangesMs: [] },
        score: { total: 4.2, hook: 4.0, standalone: 4.6, ending: 4.1, value: 4.1 },
        reason: '한 문장으로 무엇을 얻는지 말하고, 첫 장소로 바로 넘어간다.',
        credit: { channelName: '주말 산책 기록' },
      },
      overrides: { content: { cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [] }, style: {}, keepStyleOnTemplateChange: false },
      generated: blogScenes.map((s) => ttsFor(s.id, s.narration)),
    },
  ],
  provenance: { llmModel: 'fixture', promptVersion: 'm0-hand', ttsProvider: 'fixture' },
};

/* ───────── 블로그 2: 이미지 1장 → 나머지는 텍스트 카드 ───────── */

const tipScenes = [
  { id: 'sc1', narration: '배달 용기 뚜껑 뜯다가 국물 쏟은 적 있으시죠', imageAssetId: 'img-tip' },
  { id: 'sc2', narration: '모서리부터 한 번에 들어올리면 안 됩니다', textCard: '모서리부터 ❌' },
  { id: 'sc3', narration: '긴 변 가운데를 먼저 누른 다음 천천히 밀어 올리세요', textCard: '긴 변 가운데부터' },
];

const blogTip = {
  schemaVersion: SCHEMA_VERSION,
  id: 'fx-blog-tip',
  createdAt: CREATED_AT,
  input: { kind: 'blog' as const, url: 'https://example-blog.tistory.com/55', rightsAttested: true, attestedAt: CREATED_AT },
  assets: { 'img-tip': imageAsset('img-tip', ['#e8dcc8', '#b08968', '#6f4f31', '#3f2d1d'], '블로그 이미지 1/1 (자리 표시)') },
  article: { title: '배달 용기 깔끔하게 뜯는 법', blogName: '살림 기록', sections: [] },
  clips: [
    {
      id: 'c1',
      appliedTemplateId: 'b-white',
      selectedTitleIndex: 0,
      content: {
        kind: 'narrated_story' as const,
        scenes: tipScenes,
        titles: [
          { line1: '99%가 모르는', line2: '배달 용기 뜯는 법', keywordSpan: { start: 0, end: 5 } },
          { line1: '국물 안 쏟고', line2: '한 번에 뜯기', keywordSpan: { start: 0, end: 4 } },
          { line1: '모서리부터 뜯으면', line2: '안 되는 이유', keywordSpan: { start: 2, end: 6 } },
        ],
        bottomCard: { kind: 'question' as const, text: '여러분은 어디부터 뜯나요?' },
        effectMoments: [],
        autoEdit: { fillerWordIds: [], silenceRangesMs: [] },
        score: { total: 4.0, hook: 4.3, standalone: 4.4, ending: 3.7, value: 3.8 },
        reason: '흔한 실수를 먼저 짚고 해결 방법으로 끝난다.',
        credit: { channelName: '살림 기록' },
      },
      overrides: { content: { cuts: [], keepWordIds: [], captionText: {}, extraEffectMoments: [] }, style: {}, keepStyleOnTemplateChange: false },
      generated: tipScenes.map((s) => ttsFor(s.id, s.narration)),
    },
  ],
  provenance: { llmModel: 'fixture', promptVersion: 'm0-hand', ttsProvider: 'fixture' },
};

/* ───────────────────────── 쓰기 ───────────────────────── */

const all = [videoRamen, videoVariety, blogWalk, blogTip];
let failed = 0;

for (const raw of all) {
  const parsed = Project.safeParse(raw);
  if (!parsed.success) {
    failed++;
    console.error(`FAIL ${raw.id}`);
    for (const i of parsed.error.issues.slice(0, 10)) console.error(`  ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  const file = join(OUT, `${raw.id}.json`);
  writeFileSync(file, JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');
  console.log('  OK ', file);
}

process.exit(failed ? 1 : 0);
