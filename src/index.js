import 'dotenv/config';
import { startBot } from './bot.js';
import { startServer } from './server.js';

async function main() {
  const bot = await startBot();
  const server = await startServer({ bot });

  function shutdown(signal) {
    console.log(`\n${signal} received, shutting down...`);
    try { bot?.destroy?.(); } catch {}
    try { server?.close?.(); } catch {}
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
