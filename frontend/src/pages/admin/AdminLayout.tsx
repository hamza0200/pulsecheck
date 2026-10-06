import { NavLink, Outlet } from 'react-router';

const tabs = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users', end: false },
  { to: '/admin/monitors', label: 'Monitors', end: false },
];

/** Shared frame for the admin area: a heading and one tab per admin screen. */
export function AdminLayout() {
  return (
    <div>
      <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Admin</h1>
      <nav aria-label="Admin sections" className="mt-4 flex gap-6 border-b border-grid">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 pb-2.5 text-sm font-semibold transition-colors ${
                isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="pt-6">
        <Outlet />
      </div>
    </div>
  );
}
