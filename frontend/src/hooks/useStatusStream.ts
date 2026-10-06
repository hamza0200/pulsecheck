import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { monitorKeys } from '../api/monitors';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

export interface StreamNotice {
  kind: 'down' | 'recovered';
  name: string;
  at: number;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribes to the user's live check results over Server-Sent Events.
 *
 * EventSource can't send an Authorization header, so each connection first gets a one-time
 * ticket. Tickets are single-use, so EventSource's built-in auto-reconnect (which reuses
 * the same URL) can't work: on error we close it and reconnect with a fresh ticket, with
 * exponential backoff.
 */
export function useStatusStream() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');
  const [notice, setNotice] = useState<StreamNotice | null>(null);
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    // A scheduler run finishes up to 5 checks at once; batch the refetches.
    const scheduleRefresh = (monitorId?: string) => {
      clearTimeout(invalidateTimer.current);
      invalidateTimer.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: monitorKeys.list() });
        if (monitorId) {
          void queryClient.invalidateQueries({ queryKey: monitorKeys.detail(monitorId) });
        }
      }, 500);
    };

    const reconnectLater = () => {
      if (stopped) return;
      setState('reconnecting');
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    async function connect() {
      try {
        const { ticket } = await api<{ ticket: string }>('/stream/ticket', { method: 'POST' });
        if (stopped) return;
        source = new EventSource(`/api/stream?ticket=${encodeURIComponent(ticket)}`);
        source.addEventListener('ready', () => {
          attempt = 0;
          setState('live');
          scheduleRefresh(); // catch up on anything missed while disconnected
        });
        source.addEventListener('monitor.checked', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as { monitorId: string };
          scheduleRefresh(data.monitorId);
        });
        for (const kind of ['down', 'recovered'] as const) {
          source.addEventListener(`monitor.${kind}`, (event) => {
            const data = JSON.parse((event as MessageEvent<string>).data) as { name: string };
            setNotice({ kind, name: data.name, at: Date.now() });
          });
        }
        source.onerror = () => {
          source?.close();
          source = null;
          reconnectLater();
        };
      } catch {
        reconnectLater(); // ticket request failed (API down, or session expired)
      }
    }

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(invalidateTimer.current);
      source?.close();
    };
  }, [queryClient]);

  return { state, notice };
}
