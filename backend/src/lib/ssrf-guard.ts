import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { env } from '../config/env.js';

/**
 * SSRF (server-side request forgery) protection.
 *
 * Users give us arbitrary URLs and our server fetches them. Without a guard, someone could
 * point a monitor at http://127.0.0.1:5432, an internal admin panel on 10.0.0.x, or the
 * cloud metadata endpoint 169.254.169.254 (which can hand out cloud credentials), and use
 * the check results to probe our private network. So before every request (at save time,
 * at check time, and for every redirect hop) we resolve the hostname and refuse any
 * address that isn't public.
 */

export type SsrfErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNSUPPORTED_PORT'
  | 'CREDENTIALS_IN_URL'
  | 'UNRESOLVABLE_HOST'
  | 'PRIVATE_ADDRESS';

export class SsrfError extends Error {
  constructor(
    public readonly code: SsrfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

// [Node concept: networking] node:net's BlockList matches addresses against CIDR ranges
// natively, for IPv4 and IPv6, without string tricks or a dependency.
const blocked = new BlockList();
const IPV4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast 255.255.255.255
];
const IPV6_RANGES: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64: can embed a private IPv4
  ['100::', 64], // discard-only
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of IPV4_RANGES) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of IPV6_RANGES) blocked.addSubnet(net, prefix, 'ipv6');

/** True for loopback, private, link-local and reserved addresses (IPv4 or IPv6). */
export function isPrivateAddress(address: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) is really an IPv4 address in disguise.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);

  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) return blocked.check(address, 'ipv6');
  return true; // Not an IP at all: refuse rather than guess.
}

const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Synchronous checks that don't need DNS: protocol, port, credentials. */
export function parseMonitorUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('INVALID_URL', 'Enter a valid URL, e.g. https://example.com');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('UNSUPPORTED_PROTOCOL', 'Only http:// and https:// URLs can be monitored');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SsrfError('UNSUPPORTED_PORT', 'Only the standard ports 80 and 443 are allowed');
  }
  if (url.username || url.password) {
    throw new SsrfError('CREDENTIALS_IN_URL', 'URLs with a username or password are not allowed');
  }
  return url;
}

export interface GuardOptions {
  /** Defaults to the ALLOW_PRIVATE_TARGETS env flag (local testing only). */
  allowPrivate?: boolean;
}

/**
 * Validates a URL and resolves its hostname, throwing SsrfError if any resolved address is
 * private. Returns the resolved addresses.
 */
export async function assertPublicUrl(
  raw: string,
  { allowPrivate = env.ALLOW_PRIVATE_TARGETS }: GuardOptions = {},
): Promise<string[]> {
  const url = parseMonitorUrl(raw);
  // URL keeps IPv6 literals in brackets: [::1] -> ::1
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      // [Node concept: networking] dns.lookup uses the OS resolver (like the HTTP client
      // will). `all: true` returns every A/AAAA record: a hostname with one public and one
      // private address must be refused, because the client might connect to either.
      const results = await lookup(host, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new SsrfError('UNRESOLVABLE_HOST', `Could not resolve the hostname "${host}"`);
    }
    if (addresses.length === 0) {
      throw new SsrfError('UNRESOLVABLE_HOST', `Could not resolve the hostname "${host}"`);
    }
  }

  if (!allowPrivate) {
    const privateAddress = addresses.find(isPrivateAddress);
    if (privateAddress) {
      throw new SsrfError(
        'PRIVATE_ADDRESS',
        'This URL points to a private or reserved network address and cannot be monitored',
      );
    }
  }
  return addresses;
}
