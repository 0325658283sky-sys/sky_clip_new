/**
 * 종단 테스트에 쓸 샘플을 만든다.
 *
 *   npx tsx tools/e2e-setup.ts
 *
 * 남의 영상이나 글을 쓰지 않도록 ffmpeg로 만든 영상과 직접 쓴 HTML만 쓴다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = process.cwd();
const FIXTURES = join(ROOT, 'e2e', 'fixtures');
const SITE = join(FIXTURES, 'site');

mkdirSync(SITE, { recursive: true });

/* 샘플 영상 */
const video = join(FIXTURES, 'sample.mp4');
if (!existsSync(video)) {
  execFileSync(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=45',
      '-f', 'lavfi', '-i', 'sine=frequency=330:duration=45',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', video,
    ],
    { stdio: 'inherit' },
  );
  console.log('샘플 영상 생성:', video);
}

/* 샘플 블로그 이미지 (PNG를 직접 만든다) */
function writePng(path: string, width: number, height: number, rgb: [number, number, number]) {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(head) >>> 0);
    return Buffer.concat([len, head, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: width }, () => Buffer.from(rgb)))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

let table: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return crc ^ 0xffffffff;
}

writePng(join(SITE, 'walk1.png'), 960, 540, [120, 170, 110]);
writePng(join(SITE, 'walk2.png'), 960, 540, [200, 150, 100]);

writeFileSync(
  join(SITE, 'post.html'),
  `<html><head>
<meta charset="utf-8">
<meta property="og:title" content="주말 당일치기 근교 산책 코스 3곳">
<meta property="og:site_name" content="주말 산책 기록">
</head><body>
<div id="header"><a href="/">홈</a></div>
<div class="se-main-container">
<h2>멀리 안 가도 되는 곳</h2>
<p>주말에 멀리 나가기는 부담스러울 때가 있죠. 지하철로 한 시간이면 갈 수 있는 산책 코스를 정리했습니다.</p>
<img src="/walk1.png" alt="강변 산책길 입구">
<p>첫 번째는 강변 산책길입니다. 평지라서 걷기 편하고, 중간중간 벤치가 많아서 쉬어 가기 좋습니다.</p>
<img src="/walk2.png" alt="숲길 코스 나무 그늘">
<p>두 번째는 숲길 코스예요. 나무 그늘이 많아서 한여름에도 시원하게 걸을 수 있습니다.</p>
<p>세 번째는 호수 둘레길입니다. 한 바퀴 도는 데 사십 분 정도 걸리고, 자전거를 빌릴 수도 있어요.</p>
<div class="revenue_unit_wrap">광고 영역입니다</div>
</div>
<div class="comment_area"><p>댓글: 잘 보고 갑니다</p></div>
</body></html>`,
  'utf8',
);

console.log('샘플 블로그 생성:', SITE);
console.log('\n블로그 테스트를 쓰려면 다른 창에서:');
console.log(`  npx http-server ${SITE} -p 8732`);
console.log('  또는:  .venv/Scripts/python -m http.server 8732 --directory e2e/fixtures/site');
console.log('그다음:  E2E_BLOG_BASE=http://127.0.0.1:8732 npm run e2e');
