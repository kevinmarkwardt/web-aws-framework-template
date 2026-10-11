/** The frame around generated entity pages. PublicShell: a header (the site name, the public entities' links, sign in
 *  or your account) and the footer, for pages outside the dashboard. PlainShell: nothing, for pages under /dashboard
 *  (DashboardLayout frames those). Replace PublicShell with your design's header when the archetypes land. */
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ResetDemoData, useTranslation } from '@yourapp/shared';
import { AuthContext } from '../auth-context';
import SiteFooter from '../components/SiteFooter';
import { SITE } from '../site';
import { publicEntityNav } from './routes.gen';

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-raised hover:text-ink'}`;
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <Link to="/" className="font-display text-lg font-semibold text-ink">{SITE.displayName}</Link>
            <nav className="hidden items-center gap-1 sm:flex" aria-label={t('app.nav.label')}>
              {publicEntityNav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{t(n.label)}</NavLink>)}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <ResetDemoData className="hidden text-xs text-faint hover:text-ink md:inline" />
            {user ? (
              <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">{t('app.public.account')}</Link>
            ) : (
              <Link to="/login" className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">{t('app.public.signIn')}</Link>
            )}
          </div>
        </div>
        {publicEntityNav.length > 0 && (
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden" aria-label={t('app.nav.label')}>
            {publicEntityNav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{t(n.label)}</NavLink>)}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PlainShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
