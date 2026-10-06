import { describe, expect, it, vi } from 'vitest';
import { SsrfError, assertPublicUrl, isPrivateAddress } from '../src/lib/ssrf-guard.js';

vi.mock('node:dns/promises', async () => (await import('./helpers/dns.js')).dnsMockModule);

const guard = (url: string) => assertPublicUrl(url, { allowPrivate: false });

async function expectBlocked(url: string, code: string) {
  const error = await guard(url).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(SsrfError);
  expect((error as SsrfError).code).toBe(code);
}

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])(
    'allows public %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  it('blocks loopback, private, link-local/metadata and IPv6 loopback literals', async () => {
    await expectBlocked('http://127.0.0.1', 'PRIVATE_ADDRESS');
    await expectBlocked('http://10.0.0.8/admin', 'PRIVATE_ADDRESS');
    await expectBlocked('http://169.254.169.254/latest/meta-data/', 'PRIVATE_ADDRESS');
    await expectBlocked('http://[::1]/', 'PRIVATE_ADDRESS');
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    await expectBlocked('https://internal.example', 'PRIVATE_ADDRESS');
    await expectBlocked('https://metadata.example', 'PRIVATE_ADDRESS');
    await expectBlocked('https://v6-loopback.example', 'PRIVATE_ADDRESS');
  });

  it('blocks a hostname if ANY of its addresses is private', async () => {
    await expectBlocked('https://mixed.example', 'PRIVATE_ADDRESS');
  });

  it('allows public IPs and hostnames that resolve to them', async () => {
    await expect(guard('https://93.184.215.14')).resolves.toEqual(['93.184.215.14']);
    await expect(guard('https://example.com/path?q=1')).resolves.toEqual(['93.184.215.14']);
    await expect(guard('https://example.org')).resolves.toHaveLength(1);
  });

  it('only allows http(s) on ports 80/443 and no credentials', async () => {
    await expectBlocked('ftp://example.com', 'UNSUPPORTED_PROTOCOL');
    await expectBlocked('file:///etc/passwd', 'UNSUPPORTED_PROTOCOL');
    await expectBlocked('http://example.com:8080', 'UNSUPPORTED_PORT');
    await expectBlocked('https://example.com:5432', 'UNSUPPORTED_PORT');
    await expectBlocked('https://user:pass@example.com', 'CREDENTIALS_IN_URL');
    await expect(guard('http://example.com:80')).resolves.toBeDefined();
    await expect(guard('https://example.com:443')).resolves.toBeDefined();
  });

  it('rejects unresolvable hosts and garbage', async () => {
    await expectBlocked('https://does-not-exist.invalid', 'UNRESOLVABLE_HOST');
    await expectBlocked('not a url', 'INVALID_URL');
  });

  it('allows private targets only when explicitly enabled', async () => {
    await expect(assertPublicUrl('http://127.0.0.1', { allowPrivate: true })).resolves.toEqual([
      '127.0.0.1',
    ]);
  });
});
