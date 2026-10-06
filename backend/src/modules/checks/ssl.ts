import { connect } from 'node:tls';
import { assertPublicUrl } from '../../lib/ssrf-guard.js';

export const SSL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SSL_WARNING_DAYS = 14;

/** True if this monitor's certificate should be (re)checked now. */
export function isSslCheckDue(url: string, sslCheckedAt: Date | null, now = new Date()): boolean {
  if (new URL(url).protocol !== 'https:') return false;
  return !sslCheckedAt || now.getTime() - sslCheckedAt.getTime() >= SSL_CHECK_INTERVAL_MS;
}

export function daysUntil(date: Date, now = new Date()): number {
  return Math.floor((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Reads the expiry date of a host's TLS certificate.
 *
 * [Node concept: networking / tls] tls.connect performs only the TLS handshake (no HTTP).
 * `servername` sends SNI so a shared host returns the right certificate. We connect to the
 * IP address the SSRF guard just vetted (the hostname still goes in SNI), so DNS can't
 * swap in a private address between the check and the connection.
 * rejectUnauthorized: false lets us read expired or self-signed certificates too: we're
 * reporting on the certificate, not trusting it.
 */
export async function getCertificateExpiry(hostname: string, timeoutMs = 10_000): Promise<Date> {
  const [address] = await assertPublicUrl(`https://${hostname}`);
  if (!address) throw new Error(`Could not resolve ${hostname}`);

  return new Promise<Date>((resolve, reject) => {
    const socket = connect({
      host: address,
      port: 443,
      servername: hostname,
      rejectUnauthorized: false,
    });

    // [Node concept: timers] Socket inactivity timeout; destroy() fires 'error' below.
    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error(`TLS handshake timed out after ${timeoutMs} ms`));
    });

    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      socket.end(); // We only needed the handshake; close politely.
      if (!certificate?.valid_to) {
        reject(new Error('Server did not present a certificate'));
        return;
      }
      const expiresAt = new Date(certificate.valid_to);
      if (Number.isNaN(expiresAt.getTime())) {
        reject(new Error(`Unparseable certificate expiry: ${certificate.valid_to}`));
        return;
      }
      resolve(expiresAt);
    });

    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}
