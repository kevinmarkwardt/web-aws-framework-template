/** The frame around generated entity pages. PublicShell: the SiteHeader archetype (the site name, the public entities'
 *  links, sign in or your account) and the footer, for pages outside the dashboard; the pages' archetypes (Browse,
 *  Detail) bring their own width and spacing. PlainShell: nothing, for pages under /dashboard (DashboardLayout frames
 *  those). The design direction changes SiteHeader's `variant` here. */
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ResetDemoData, useTranslation } from '@yourapp/shared';
import { SiteHeader } from '@yourapp/shared/archetypes';
import { AuthContext } from '../auth-context';
import SiteFooter from '../components/SiteFooter';
import { SITE } from '../site';
import { publicEntityNav } from './paths.gen';

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useContext(AuthContext);
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <SiteHeader
        brand={SITE.displayName}
        nav={publicEntityNav.map((n) => ({ label: t(n.label), href: n.to }))}
        right={
          <div className="flex items-center gap-3">
            <ResetDemoData className="text-xs text-faint hover:text-ink" />
            {user ? (
              <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">{t('app.public.account')}</Link>
            ) : (
              <Link to="/login" className="rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-700">{t('app.public.signIn')}</Link>
            )}
          </div>
        }
      />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function PlainShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
