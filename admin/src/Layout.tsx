import { Suspense, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Badge, Loading, useTranslation } from '@yourapp/shared';
import { Icon } from './icons';
import { siteUrl, useMe } from './session';
import { SECTIONS, visibleTabs } from './tabs/registry';
import type { AdminTab } from './tabs/registry';

function Sidebar({ tabs, onNavigate }: { tabs: AdminTab[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const groups = useMemo(() => {
    const out: { section: string; tabs: AdminTab[] }[] = [];
    for (const tab of tabs) {
      const last = out[out.length - 1];
      if (last && last.section === tab.section) last.tabs.push(tab);
      else out.push({ section: tab.section, tabs: [tab] });
    }
    return out;
  }, [tabs]);
  return (
    <nav className="flex h-full flex-col bg-chrome text-chrome-ink">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><Icon name="shield" className="h-5 w-5" /></span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white">YourApp</div>
          <div className="text-xs text-chrome-ink/70">{t('admin.layout.admin')}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.section} className="mt-4 first:mt-0">
            {g.section !== SECTIONS[0] && (
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-chrome-ink/50">{t(g.section)}</div>
            )}
            {g.tabs.map((tab) => (
              <NavLink
                key={tab.id}
                to={`/${tab.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors ${
                    isActive ? 'bg-chrome-active text-white' : 'hover:bg-chrome-active/60 hover:text-white'
                  }`}
              >
                <Icon name={tab.icon} />
                {t(tab.label)}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      {siteUrl(me) && (
        <a href={siteUrl(me)} className="mx-3 mb-4 flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-chrome-active/60 hover:text-white">
          <Icon name="external" className="h-4 w-4" /> {t('admin.layout.openSite')}
        </a>
      )}
    </nav>
  );
}

export default function Layout({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const tabs = useMemo(() => visibleTabs(me), [me]);
  const [menuOpen, setMenuOpen] = useState(false);
  const first = tabs[0]?.id ?? 'overview';

  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block"><Sidebar tabs={tabs} /></aside>
      {/* mobile sidebar */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64"><Sidebar tabs={tabs} onNavigate={() => setMenuOpen(false)} /></aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-1.5 text-muted hover:bg-raised lg:hidden" onClick={() => setMenuOpen(true)} aria-label={t('admin.layout.openMenu')}>
              <Icon name="menu" />
            </button>
            <Badge tone={me.stage === 'prod' ? 'danger' : 'warn'}>{me.stage === 'prod' ? t('admin.layout.production') : t('admin.layout.stage', { stage: me.stage })}</Badge>
            <span className="hidden text-xs text-faint sm:inline">{t('admin.layout.billing', { mode: me.billingMode })}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{me.email}</span>
            <button onClick={onSignOut} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-raised hover:text-ink">
              <Icon name="logout" className="h-4 w-4" /> {t('admin.actions.signOut')}
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route index element={<Navigate to={`/${first}`} replace />} />
              {tabs.map((tab) => (
                <Route key={tab.id} path={`/${tab.id}`} element={<tab.component />} />
              ))}
              <Route path="*" element={<Navigate to={`/${first}`} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
