import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/PageState';
import { Forbidden } from '../pages/Forbidden';
import { useAuth } from './AuthProvider';

/** Logged-in users only. Guests go to /login, which sends them back here afterwards. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Admins only. The API enforces this too; this just avoids showing a broken page. */
export function AdminRoute() {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? <Outlet /> : <Forbidden />;
}

/**
 * Login/signup/forgot-password: a logged-in user has no business here. This is also what
 * moves the user on after logging in: once the auth state flips to authenticated, they go
 * to the page ProtectedRoute bounced them from (or the dashboard).
 */
export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from;
    return <Navigate to={from ? `${from.pathname}${from.search ?? ''}` : '/dashboard'} replace />;
  }
  return <Outlet />;
}
