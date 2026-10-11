import { useContext, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '@yourapp/shared';
import { AuthContext } from '../../auth-context';
import { logout } from '../../auth';
import { updateSettings } from '../../api';
import { creditsOn, shortDate, subscriptionsOn, units } from '../../billing';
import { useAccountNotes } from '../../notes';
import AccountBanner from '../../components/AccountBanner';
import SiteFooter from '../../components/SiteFooter';
import { SITE } from '../../site';

const badgeClass = (plan: string) =>
  plan === 'free' ? 'bg-gray-100 text-gray-700' : 'bg-brand-100 text-brand-700';

/** The admin site (admin.<domain>; written by scripts/deploy.sh from the stack's AdminUrl). Locally: admin/ on :5174. */
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || (import.meta.env.DEV ? 'http://localhost:5174' : '');

/** Alert kinds (api/lib/notes.py `kind`) shown with a warning colour. */
const SERIOUS = new Set(['warning', 'banned', 'reload_failed', 'billing']);

export default function DashboardLayout() {
  const { user, refresh } = useContext(AuthContext);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { notes, dismiss } = useAccountNotes();

  const handleLogout = async () => {
    await logout();
    await refresh();
    navigate('/login');
  };

  /** The footer's language picker: the profile keeps the choice too, so emails follow it. */
  const saveLanguage = (language: string) => {
    updateSettings({ language }).then(refresh).catch(() => {});
  };

  const plan = user?.plan || 'free';
  const mode = user?.billingMode;

  // Billing pages appear only for the modules that are on (the API answers 404 for the others)
  const navItems = [
    { to: '/dashboard', label: t('app.nav.items'), end: true },
    ...(subscriptionsOn(mode) ? [{ to: '/dashboard/plans', label: t('app.nav.plans') }] : []),
    ...(creditsOn(mode) ? [{ to: '/dashboard/wallet', label: t('app.nav.wallet') }] : []),
    { to: '/dashboard/settings', label: t('app.nav.settings') },
    { to: '/dashboard/reports', label: t('app.nav.reports') },
    { to: '/dashboard/support', label: t('app.nav.support') },
  ];

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo + Nav */}
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
                <span className="text-lg font-bold text-gray-900">{SITE.displayName}</span>
              </div>
              <nav className="hidden md:flex items-center gap-1" aria-label={t('app.nav.label')}>
                {navItems.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {creditsOn(mode) && user && (
                <NavLink to="/dashboard/wallet" className="hidden sm:inline text-sm text-gray-700 hover:text-gray-900">
                  {units(user.credits ?? 0, user.creditName)}
                </NavLink>
              )}
              {subscriptionsOn(mode) && (
                <span className={`hidden sm:inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full capitalize ${badgeClass(plan)}`}>
                  {plan}
                </span>
              )}
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                  aria-label={notes.length ? t('app.menu.labelWithAlerts', { count: notes.length }) : t('app.menu.label')}
                  aria-expanded={menuOpen}
                >
                  <span className="hidden sm:inline">{user?.name || user?.email}</span>
                  {notes.length > 0 && (
                    <span className="bg-red-600 text-white text-[10px] font-semibold rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
                      {notes.length}
                    </span>
                  )}
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    <div className="px-4 py-2 text-sm text-gray-500 border-b border-gray-100 sm:hidden">
                      {user?.email}
                    </div>
                    {/* account alerts (api/lib/notes.py): warnings, a ban, failed payments, support replies... */}
                    <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      {t('app.menu.alerts')}
                    </div>
                    {notes.length === 0 && <p className="px-4 pb-3 text-xs text-gray-500 border-b border-gray-100">{t('app.menu.noAlerts')}</p>}
                    {notes.map((n) => (
                      <div key={n.id} className={`px-4 py-3 border-b border-gray-100 ${SERIOUS.has(n.kind) ? 'bg-amber-50' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900">{n.title}</p>
                          <button onClick={() => dismiss(n.id)} className="text-xs text-gray-400 hover:text-gray-700" aria-label={t('app.menu.dismiss')}>
                            ✕
                          </button>
                        </div>
                        {n.message && <p className="text-xs text-gray-600 mt-1">{n.message}</p>}
                        <p className="text-[11px] text-gray-400 mt-1">{shortDate(n.createdAt)}</p>
                      </div>
                    ))}
                    <NavLink to="/dashboard/settings" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      {t('app.nav.settings')}
                    </NavLink>
                    {user?.isAdmin && ADMIN_URL && (
                      // the admin site re-checks the Cognito group and the profile flag on every request
                      <a href={ADMIN_URL} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        {t('app.menu.admin')}
                      </a>
                    )}
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t('app.signOut')}
                    </button>
                  </div>
                )}
              </div>

              {/* Mobile hamburger */}
              <button
                className="md:hidden p-2 text-gray-600"
                onClick={() => setMobileNavOpen(!mobileNavOpen)}
                aria-label={t('app.nav.toggle')}
                aria-expanded={mobileNavOpen}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile nav */}
          {mobileNavOpen && (
            <nav className="md:hidden pb-3 flex flex-col gap-1" aria-label={t('app.nav.label')}>
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMobileNavOpen(false)} className={navClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
        {user && <AccountBanner user={user} />}
        <Outlet />
      </main>
      <SiteFooter onLanguage={saveLanguage} />
    </div>
  );
}
