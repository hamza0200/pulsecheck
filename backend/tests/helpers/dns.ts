import type { LookupAddress } from 'node:dns';

/** Hostname -> addresses. Anything else fails like a real NXDOMAIN. */
export const FAKE_DNS: Record<string, string[]> = {
  'example.com': ['93.184.215.14'],
  'www.example.com': ['93.184.215.14'],
  'example.org': ['2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'internal.example': ['10.0.0.5'],
  'metadata.example': ['169.254.169.254'],
  'mixed.example': ['93.184.215.14', '192.168.1.10'],
  'v6-loopback.example': ['::1'],
};

export async function fakeLookup(hostname: string): Promise<LookupAddress[]> {
  const addresses = FAKE_DNS[hostname];
  if (!addresses) {
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  }
  return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

/** Use with: vi.mock('node:dns/promises', () => dnsMockModule) */
export const dnsMockModule = { lookup: fakeLookup, default: { lookup: fakeLookup } };
