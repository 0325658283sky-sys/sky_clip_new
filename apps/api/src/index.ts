import { HOST, OFFLINE, PORT } from './config.js';
import { startCleanupSchedule } from './cleanup.js';
import { buildServer } from './server.js';

const { app, store } = buildServer();
const stopCleanup = startCleanupSchedule(store);

async function main() {
  await app.listen({ port: PORT, host: HOST });
  console.log(`SkyCut API — http://${HOST}:${PORT}`);
  if (OFFLINE) {
    console.log('  오프라인 모드: LLM과 STT/TTS를 부르지 않습니다. 결과 품질은 의미 없습니다.');
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopCleanup();
    store.flush();
    void app.close().then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
