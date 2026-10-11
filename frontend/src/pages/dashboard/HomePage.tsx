/* The signed-in Home page (/dashboard): where a new account lands after sign-up. A greeting, a getting-started
   checklist that disappears once it's done, the account at a glance (plan or balance, alerts), recent alerts and the
   account pages. Generic on purpose: it reads only the account, so it stays when the Items example goes. A site adds
   its own first steps to `steps` and its own tiles. */
import { useContext } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SITE_CONFIG, useTranslation } from '@yourapp/shared';
import { AuthContext } from '../../auth-context';
import { creditsOn, shortDate, subscriptionsOn, units } from '../../billing';
import { useAccountNotes } from '../../notes';

interface Step { key: string; done: boolean; to?: string }

function Tile({ label, value, hint, to, cta }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; cta?: string }) {
  return (
    <div className="flex flex-col rounded-card border border-line bg-panel p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold capitalize text-ink tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {to && cta && <Link to={to} className="mt-auto pt-4 text-sm font-medium text-brand-700 hover:underline">{cta}</Link>}
    </div>
  );
}

export default function HomePage() {
  const { user } = useContext(AuthContext);
  const { t } = useTranslation();
  const { notes } = useAccountNotes();
  if (!user) return null;

  const mode = user.billingMode;
  const firstName = (user.name || user.email.split('@')[0]).split(' ')[0];

  const steps: Step[] = [
    { key: 'account', done: true },
    { key: 'profile', done: !!user.name && !user.name.includes('@'), to: '/dashboard/settings' },
    { key: 'firstItem', done: user.itemCount > 0, to: '/dashboard/items' }, // example:items
    ...(subscriptionsOn(mode) ? [{ key: 'plan', done: user.plan !== 'free', to: '/dashboard/plans' }] : []),
    ...(creditsOn(mode) ? [{ key: 'credits', done: !!user.hasToppedUp, to: '/dashboard/wallet' }] : []),
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  // still setting up: "Welcome"; everything done: "Welcome back"
  const isNew = done < steps.length;

  const links = [
    { to: '/dashboard/settings', key: 'settings' },
    ...(subscriptionsOn(mode) ? [{ to: '/dashboard/plans', key: 'plans' }] : []),
    ...(creditsOn(mode) ? [{ to: '/dashboard/wallet', key: 'wallet' }] : []),
    ...(SITE_CONFIG.support ? [{ to: '/dashboard/support', key: 'support' }] : []),
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
          {t(isNew ? 'home.greeting' : 'home.greetingBack', { name: firstName })}
        </h1>
        <p className="mt-1 text-muted">{t('home.subtitle')}</p>
      </header>

      {done < steps.length && (
        <section aria-labelledby="start" className="rounded-card border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 id="start" className="font-semibold text-ink">{t('home.start.title')}</h2>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted tabular-nums">{t('home.start.progress', { done, total: steps.length })}</span>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-raised" aria-hidden>
                <span className="block h-full rounded-full bg-brand-600 transition-[width] duration-700" style={{ width: `${(done / steps.length) * 100}%` }} />
              </span>
            </div>
          </div>
          <ol>
            {steps.map((s, i) => (
              <li key={s.key} className={`flex items-center gap-4 border-b border-line px-5 py-4 last:border-0 ${s === next ? 'bg-brand-50/40' : ''}`}>
                <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${s.done ? 'bg-brand-600 text-brand-ink' : 'border border-line-strong text-muted'}`}>
                  {s.done
                    ? <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.done ? 'text-muted line-through decoration-line-strong' : 'text-ink'}`}>{t(`home.start.${s.key}`)}</p>
                  <p className="text-sm text-muted">{t(`home.start.${s.key}Desc`)}</p>
                </div>
                {!s.done && s.to && (
                  <Link to={s.to} className={`shrink-0 rounded-control px-3 py-1.5 text-sm font-medium ${s === next ? 'bg-brand-600 text-brand-ink hover:bg-brand-700' : 'border border-line-strong text-ink hover:bg-raised'}`}>
                    {t('home.start.open')}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {subscriptionsOn(mode) && (
          <Tile label={t('home.tiles.plan')} value={user.plan}
            hint={user.itemLimit === null ? t('home.tiles.usageUnlimited', { count: user.itemCount }) : t('home.tiles.usage', { count: user.itemCount, limit: user.itemLimit })}
            to="/dashboard/plans" cta={t('home.tiles.manage')} />
        )}
        {creditsOn(mode) && (
          <Tile label={t('home.tiles.credits')} value={units(user.credits ?? 0, user.creditName)} to="/dashboard/wallet" cta={t('home.tiles.manage')} />
        )}
        <Tile label={t('home.tiles.alerts')} value={notes.length}
          hint={notes.length ? t('home.tiles.alertsSome', { count: notes.length }) : t('home.tiles.alertsNone')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="activity" className="rounded-card border border-line bg-panel">
          <h2 id="activity" className="border-b border-line px-5 py-4 font-semibold text-ink">{t('home.activity.title')}</h2>
          {notes.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="font-medium text-ink">{t('home.activity.empty')}</p>
              <p className="mt-1 text-sm text-muted">{t('home.activity.emptyDesc')}</p>
            </div>
          ) : (
            <ul>
              {notes.slice(0, 6).map((n) => (
                <li key={n.id} className="border-b border-line px-5 py-4 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    <span className="shrink-0 font-mono text-xs text-faint">{shortDate(n.createdAt)}</span>
                  </div>
                  {n.message && <p className="mt-1 text-sm text-muted">{n.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav aria-labelledby="links" className="rounded-card border border-line bg-panel">
          <h2 id="links" className="border-b border-line px-5 py-4 font-semibold text-ink">{t('home.links.title')}</h2>
          <ul>
            {links.map((l) => (
              <li key={l.key} className="border-b border-line last:border-0">
                <Link to={l.to} className="group flex items-center justify-between gap-3 px-5 py-4 hover:bg-raised">
                  <span>
                    <span className="block text-sm font-medium text-ink">{t(`home.links.${l.key}`)}</span>
                    <span className="block text-sm text-muted">{t(`home.links.${l.key}Desc`)}</span>
                  </span>
                  <svg aria-hidden className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
