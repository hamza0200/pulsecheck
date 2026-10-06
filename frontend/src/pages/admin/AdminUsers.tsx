import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { useAdminUsers, useSetUserDisabled } from '../../api/admin';
import { ApiError } from '../../api/client';
import type { AdminUser } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button, TextField } from '../../components/forms';
import { EmptyState, ErrorState, Spinner } from '../../components/PageState';
import { formatDate } from '../../lib/format';

export function AdminUsers() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  // Deferred: typing stays responsive and queries follow a beat behind.
  const query = useDeferredValue(search.trim());
  const users = useAdminUsers(query);
  const setDisabled = useSetUserDisabled();
  const [target, setTarget] = useState<AdminUser | null>(null);

  const rows = users.data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <div>
      <h2 className="sr-only">Users</h2>
      <div className="max-w-sm">
        <TextField
          label="Search by email"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {users.isPending ? (
        <div className="mt-6">
          <Spinner label="Loading users" />
        </div>
      ) : users.isError ? (
        <ErrorState
          message="The users list could not be loaded."
          onRetry={() => void users.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={query ? `No users match "${query}"` : 'No users yet'} />
      ) : (
        <>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="sr-only">Users, newest first</caption>
              <thead>
                <tr className="border-b border-grid text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Email
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Role
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Monitors
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Signed up
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-b border-grid">
                    <td className="py-3 pr-4 font-semibold">
                      {u.email}
                      {u.id === me?.id && (
                        <span className="ml-2 font-normal text-muted">(you)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4">{u.role === 'ADMIN' ? 'Admin' : 'User'}</td>
                    <td className={`py-3 pr-4 ${u.isDisabled ? 'font-semibold text-down' : ''}`}>
                      {u.isDisabled ? 'Disabled' : 'Active'}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      {u.monitorCount > 0 ? (
                        <Link
                          to={`/admin/monitors?userId=${u.id}&email=${encodeURIComponent(u.email)}`}
                          className="font-semibold underline underline-offset-4"
                          aria-label={`View ${u.monitorCount} monitors of ${u.email}`}
                        >
                          {u.monitorCount}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap">{formatDate(u.createdAt)}</td>
                    <td className="py-3 text-right">
                      {u.id !== me?.id && (
                        <Button
                          variant={u.isDisabled ? 'secondary' : 'dangerGhost'}
                          className="px-3 py-1"
                          onClick={() => setTarget(u)}
                        >
                          {u.isDisabled ? 'Enable' : 'Disable'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.hasNextPage && (
            <Button
              variant="secondary"
              className="mt-4"
              pending={users.isFetchingNextPage}
              pendingLabel="Loading…"
              onClick={() => void users.fetchNextPage()}
            >
              Load more
            </Button>
          )}
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        title={target?.isDisabled ? `Enable ${target.email}?` : `Disable ${target?.email ?? ''}?`}
        confirmLabel={target?.isDisabled ? 'Enable user' : 'Disable user'}
        tone={target?.isDisabled ? 'primary' : 'danger'}
        pending={setDisabled.isPending}
        error={setDisabled.error instanceof ApiError ? setDisabled.error.message : null}
        onCancel={() => {
          setDisabled.reset();
          setTarget(null);
        }}
        onConfirm={() => {
          if (!target) return;
          setDisabled.mutate(
            { id: target.id, isDisabled: !target.isDisabled },
            { onSuccess: () => setTarget(null) },
          );
        }}
      >
        {target?.isDisabled
          ? 'They can log in again and their monitors resume.'
          : 'They are signed out everywhere, can no longer log in, and their monitors stop being checked.'}
      </ConfirmDialog>
    </div>
  );
}
