import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Account } from './types';

const accountKey = ['account'] as const;

export function useAccount() {
  return useQuery({
    queryKey: accountKey,
    queryFn: async () => (await api<{ account: Account }>('/account')).account,
  });
}

export function useUpdateAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertsEnabled: boolean) =>
      (await api<{ account: Account }>('/account', { method: 'PATCH', body: { alertsEnabled } }))
        .account,
    onSuccess: (account) => queryClient.setQueryData(accountKey, account),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api<{ message: string }>('/account/change-password', { method: 'POST', body }),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (password: string) =>
      api<void>('/account', { method: 'DELETE', body: { password } }),
  });
}
