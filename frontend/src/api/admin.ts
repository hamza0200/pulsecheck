import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AdminMonitor, AdminMonitorStatusFilter, AdminStats, AdminUser } from './types';

const adminKeys = {
  stats: ['admin', 'stats'] as const,
  users: (search: string) => ['admin', 'users', search] as const,
  monitors: (filters: AdminMonitorFilters) => ['admin', 'monitors', filters] as const,
};

export interface AdminMonitorFilters {
  search: string;
  userId: string;
  status: AdminMonitorStatusFilter;
}

/** Every user's monitors (read-only), filtered and cursor-paginated. */
export function useAdminMonitors(filters: AdminMonitorFilters, pageSize = 25) {
  return useInfiniteQuery({
    queryKey: adminKeys.monitors(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (filters.search) params.set('search', filters.search);
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.status) params.set('status', filters.status);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ monitors: AdminMonitor[]; nextCursor: string | null }>(
        `/admin/monitors?${params}`,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats,
    queryFn: () => api<AdminStats>('/admin/stats'),
    refetchInterval: 30_000,
  });
}

export function useAdminUsers(search: string, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: adminKeys.users(search),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (search) params.set('search', search);
      if (pageParam) params.set('cursor', pageParam);
      return api<{ users: AdminUser[]; nextCursor: string | null }>(`/admin/users?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSetUserDisabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isDisabled }: { id: string; isDisabled: boolean }) =>
      (
        await api<{ user: AdminUser }>(`/admin/users/${id}`, {
          method: 'PATCH',
          body: { isDisabled },
        })
      ).user,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}
