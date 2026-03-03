import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../../admin-api';

const navGroups = [
  {
    label: 'Platform',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/users', label: 'Users' },
      { to: '/billing', label: 'Billing' },
      { to: '/health', label: 'Health' },
    ],
  },
  {
    label: 'App Data',
    items: [
      { to: '/data/items', label: 'Items' },
      { to: '/data/second-entity', label: 'Second Entity' },
    ],
  },
  {
    label: 'App Config',
    items: [
      { to: '/config/features', label: 'Feature Toggles' },
      { to: '/config/plans', label: 'Plan Limits' },
      { to: '/config/jobs', label: 'Job Settings' },
      { to: '/config/email', label: 'Email Templates' },
    ],
  },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminToken();
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-700">
          <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <span className="font-bold text-sm">YourApp Manager</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={'end' in item ? (item as any).end : undefined}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-2 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
