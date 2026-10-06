/**
 * Process lifecycle (runs the real server as a child process against the test DB).
 * - SIGTERM shuts down gracefully: logs "Shutdown complete" and exits with code 0,
 *   even with an idle keep-alive connection open
 * - Starting on a port that is already in use exits with code 1 and a clear message
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Agent, request } from 'node:http';
import { describe, expect, it } from 'vitest';

async function freePort(): Promise<number> {
  const server = createServer().listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  return port;
}

function startServer(port: number) {
  const child = spawn('npx', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production', // plain JSON logs we can read
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      APP_URL: 'http://localhost:5173',
      SCHEDULER_ENABLED: 'false',
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function exitCode(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  const [code] = (await once(child, 'exit')) as [number | null];
  return code;
}

describe('graceful shutdown', () => {
  it('exits 0 on SIGTERM, closing idle keep-alive connections', async () => {
    const port = await freePort();
    const { child, output } = startServer(port);
    try {
      await waitFor(() => output().includes('listening'));
      // Leave a keep-alive connection open; server.close() alone would wait for it.
      const agent = new Agent({ keepAlive: true });
      await new Promise<void>((resolve, reject) => {
        request({ port, path: '/health', agent }, (res) => {
          res.resume();
          res.on('end', () => resolve());
        })
          .on('error', reject)
          .end();
      });

      const started = Date.now();
      child.kill('SIGTERM');
      expect(await exitCode(child)).toBe(0);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(output()).toContain('Shutdown complete');
      agent.destroy();
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);

  it('exits 1 with a clear message when the port is taken', async () => {
    const blocker = createServer().listen(0);
    await once(blocker, 'listening');
    const { port } = blocker.address() as { port: number };
    const { child, output } = startServer(port);
    try {
      expect(await exitCode(child)).toBe(1);
      expect(output()).toContain(`Port ${port} is already in use`);
    } finally {
      child.kill('SIGKILL');
      blocker.close();
    }
  }, 30_000);
});
