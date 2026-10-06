import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

const app = createApp();
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info(`PulseCheck API listening on http://localhost:${env.PORT}`);
});

let shuttingDown = false;

// [Node concept: process lifecycle] Signals let us finish in-flight work before exiting.
// SIGINT is Ctrl+C; SIGTERM is what Docker, systemd and PaaS platforms send.
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  // Hard cap so a stuck dependency can't keep the process alive forever.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  // Stop accepting new connections; resolves when in-flight requests finish.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await prisma.$disconnect();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// [Node concept: process lifecycle] After an unexpected error the process may be in an
// unknown state; log it and exit so a supervisor (or the developer) can restart cleanly.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
