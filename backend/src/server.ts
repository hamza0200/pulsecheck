import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { mailer } from './lib/mailer.js';
import { prisma } from './lib/prisma.js';
import { registerAlertListeners } from './modules/alerts/alerts.service.js';
import { waitForCurrentRun } from './modules/checks/runner.js';
import { closeAllStreams } from './modules/stream/stream.service.js';
import { startScheduler, stopScheduler } from './modules/checks/scheduler.js';

registerAlertListeners();

const app = createApp();
const server = createServer(app);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.fatal(
      `Port ${env.PORT} is already in use. Stop the other process or set PORT in backend/.env.`,
    );
  } else {
    logger.fatal({ err }, 'HTTP server error');
  }
  process.exit(1);
});

server.listen(env.PORT, () => {
  logger.info(`PulseCheck API listening on http://localhost:${env.PORT}`);
  if (env.SCHEDULER_ENABLED) startScheduler();
  else logger.info('Check scheduler disabled (SCHEDULER_ENABLED=false)');
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

  // 1. No new work: stop the scheduler's timers.
  stopScheduler();
  // 2. Stop accepting connections. close() resolves once every open connection has ended,
  //    so end the long-lived SSE streams and idle keep-alive sockets straight away;
  //    in-flight requests get to finish.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  closeAllStreams();
  server.closeIdleConnections();
  // 3. Meanwhile, let a check run in progress finish its writes (capped at 10s), so no
  //    check is half-recorded.
  await Promise.all([closed, waitForCurrentRun(10_000)]);
  // 4. Only now release shared resources the requests and checks were using.
  mailer.close();
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
