import { Navigate, type RouteObject } from 'react-router';
import { AdminRoute, GuestRoute, ProtectedRoute } from './auth/guards';
import { AppShell } from './components/AppShell';
import { Account } from './pages/Account';
import { AdminOverview } from './pages/admin/AdminOverview';
import { AdminUsers } from './pages/admin/AdminUsers';
import { Dashboard } from './pages/Dashboard';
import { ForgotPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
import { MonitorDetail } from './pages/MonitorDetail';
import { MonitorForm } from './pages/MonitorForm';
import { NotFound } from './pages/NotFound';
import { ResetPassword } from './pages/ResetPassword';
import { Signup } from './pages/Signup';

/** All routes. Exported so tests can mount them in a memory router. */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <GuestRoute />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/signup', element: <Signup /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
    ],
  },
  // Reachable logged in or not: the link comes from an email.
  { path: '/reset-password', element: <ResetPassword /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: <Dashboard /> },
          { path: '/monitors/new', element: <MonitorForm /> },
          { path: '/monitors/:id', element: <MonitorDetail /> },
          { path: '/monitors/:id/edit', element: <MonitorForm /> },
          { path: '/account', element: <Account /> },
          {
            element: <AdminRoute />,
            children: [
              { path: '/admin', element: <AdminOverview /> },
              { path: '/admin/users', element: <AdminUsers /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];
