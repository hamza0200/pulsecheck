import { Navigate, type RouteObject } from 'react-router';
import { AdminRoute, GuestRoute, ProtectedRoute } from './auth/guards';
import { AppShell } from './components/AppShell';
import { Account } from './pages/Account';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AdminMonitors } from './pages/admin/AdminMonitors';
import { AdminOverview } from './pages/admin/AdminOverview';
import { AdminUsers } from './pages/admin/AdminUsers';
import { Dashboard } from './pages/Dashboard';
import { ForgotPassword } from './pages/ForgotPassword';
import { Login } from './pages/Login';
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
          {
            path: '/monitors/:id',
            // Code-split: the chart library (Recharts) is only downloaded for this page.
            lazy: async () => ({
              Component: (await import('./pages/MonitorDetail')).MonitorDetail,
            }),
          },
          { path: '/monitors/:id/edit', element: <MonitorForm /> },
          { path: '/account', element: <Account /> },
          {
            element: <AdminRoute />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { path: '/admin', element: <AdminOverview /> },
                  { path: '/admin/users', element: <AdminUsers /> },
                  { path: '/admin/monitors', element: <AdminMonitors /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];
