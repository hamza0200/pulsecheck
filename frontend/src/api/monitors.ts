import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from './client';
import type { Check, CheckResult, Incident, Monitor, MonitorDetail, MonitorList } from './types';

export const monitorKeys = {
  all: ['monitors'] as const,
  list: () => [...monitorKeys.all, 'list'] as const,
  detail: (id: string) => [...monitorKeys.all, 'detail', id] as const,
  checks: (id: string) => [...monitorKeys.all, 'checks', id] as const,
  chart: (id: string) => [...monitorKeys.all, 'chart', id] as const,
  incidents: (id: string) => [...monitorKeys.all, 'incidents', id] as const,
};

export function useMonitors() {
  return useQuery({ queryKey: monitorKeys.list(), queryFn: () => api<MonitorList>('/monitors') });
}

export function useMonitor(id: string) {
  return useQuery({
    queryKey: monitorKeys.detail(id),
    queryFn: async () => (await api<{ monitor: MonitorDetail }>(`/monitors/${id}`)).monitor,
  });
}

/** Checks from the last 24 hours, oldest first, for the response-time chart. */
export function useChartChecks(id: string) {
  return useQuery({
    queryKey: monitorKeys.chart(id),
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams({ since, limit: '500' });
      const { checks } = await api<{ checks: Check[] }>(`/monitors/${id}/checks?${params}`);
      return checks.reverse();
    },
  });
}

export function useCheckHistory(id: string, pageSize = 25) {
  return useInfiniteQuery({
    queryKey: monitorKeys.checks(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (pageParam) params.set('cursor', pageParam);
      return api<{ checks: Check[]; nextCursor: string | null }>(
        `/monitors/${id}/checks?${params}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useIncidents(id: string) {
  return useQuery({
    queryKey: monitorKeys.incidents(id),
    queryFn: async () =>
      (await api<{ incidents: Incident[] }>(`/monitors/${id}/incidents?limit=20`)).incidents,
  });
}

export interface MonitorInput {
  name?: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
}

/** Every mutation refreshes all monitor queries: they're cheap and always consistent. */
function useMonitorMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: monitorKeys.all }),
  });
}

export function useCreateMonitor() {
  return useMonitorMutation(
    async (input: MonitorInput) =>
      (await api<{ monitor: Monitor }>('/monitors', { method: 'POST', body: input })).monitor,
  );
}

export function useUpdateMonitor() {
  return useMonitorMutation(
    async ({ id, ...patch }: Partial<MonitorInput> & { id: string; isPaused?: boolean }) =>
      (await api<{ monitor: Monitor }>(`/monitors/${id}`, { method: 'PATCH', body: patch }))
        .monitor,
  );
}

export function useDeleteMonitor() {
  return useMonitorMutation((id: string) => api<void>(`/monitors/${id}`, { method: 'DELETE' }));
}

export function useCheckNow() {
  return useMonitorMutation((id: string) =>
    api<{ check: CheckResult; monitor: MonitorDetail }>(`/monitors/${id}/check-now`, {
      method: 'POST',
    }),
  );
}

/**
 * Downloads the CSV export. A plain <a href> can't send the Authorization header, so fetch
 * it, then hand the blob to the browser as a download.
 */
export async function downloadChecksCsv(id: string): Promise<void> {
  const res = await apiFetch(`/monitors/${id}/export.csv`);
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'checks.csv';
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
