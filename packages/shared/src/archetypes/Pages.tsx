import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionButton, Container } from './parts';
import { cx } from './util';
import type { Action } from './parts';

/** A signed-in overview: greeting, key numbers, then panels in a 3-column grid (a panel can span 2). */
export function DashboardArchetype({ title, subtitle, actions, stats, children }:
  { title: ReactNode; subtitle?: ReactNode; actions?: Action[]; stats?: { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; children?: ReactNode }) {
  return (
    <Container width="wide" className="py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions.map((a, i) => <ActionButton key={i} action={a} />)}</div>}
      </div>
      {stats && stats.length > 0 && (
        <dl className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s, i) => (
            <div key={i} className="rounded-card border border-line bg-panel p-5">
              <dt className="text-xs font-medium uppercase tracking-wide text-faint">{s.label}</dt>
              <dd className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums">{s.value}</dd>
              {s.hint && <dd className="mt-1 text-xs text-muted">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}
      <div className="grid gap-6 lg:grid-cols-3">{children}</div>
    </Container>
  );
}

export function DashboardPanel({ title, action, span = 1, children }: { title: ReactNode; action?: ReactNode; span?: 1 | 2 | 3; children: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-card border border-line bg-panel', span === 2 && 'lg:col-span-2', span === 3 && 'lg:col-span-3')}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export interface FormSection {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/** Create/edit a record: titled sections (label column on wide screens) and a sticky save bar. The page owns the form
 *  state; pass `onSubmit`. */
export function FormArchetype({ title, subtitle, sections, onSubmit, submitLabel, onCancel, busy, error, dirty = true }:
  { title: ReactNode; subtitle?: ReactNode; sections: FormSection[]; onSubmit: () => void; submitLabel?: ReactNode;
    onCancel?: () => void; busy?: boolean; error?: ReactNode; dirty?: boolean }) {
  const { t } = useTranslation();
  return (
    <Container width="default" className="py-8">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <div className="mb-8">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        </div>
        <div className="divide-y divide-line rounded-card border border-line bg-panel">
          {sections.map((s, i) => (
            <fieldset key={i} className="grid gap-6 p-6 md:grid-cols-[16rem_1fr]">
              <div>
                <legend className="font-semibold text-ink">{s.title}</legend>
                {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
              </div>
              <div className="space-y-5">{s.children}</div>
            </fieldset>
          ))}
        </div>
        <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-line bg-surface/90 py-4 backdrop-blur">
          {error && <p role="alert" className="mr-auto text-sm text-danger">{error}</p>}
          {onCancel && <ActionButton action={{ label: t('common.archetypes.cancel'), onClick: onCancel, variant: 'ghost' }} />}
          <button
            type="submit"
            disabled={busy || !dirty}
            className="rounded-control bg-brand-600 px-5 py-2 text-sm font-medium text-brand-ink hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? t('common.archetypes.saving') : submitLabel ?? t('common.archetypes.save')}
          </button>
        </div>
      </form>
    </Container>
  );
}

export interface PricingPlan {
  id: string;
  name: ReactNode;
  price: ReactNode;
  period?: ReactNode;
  description?: ReactNode;
  features: ReactNode[];
  action: Action;
  highlighted?: boolean;
  badge?: ReactNode;
}

/** Plans side by side (subscriptions) or packs (credits). Highlight the one to steer people to. */
export function PricingArchetype({ eyebrow, title, subtitle, plans, footnote }:
  { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; plans: PricingPlan[]; footnote?: ReactNode }) {
  return (
    <div className="section-y">
      <Container width="wide">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          {eyebrow && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>}
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-4 text-lg text-muted">{subtitle}</p>}
        </div>
        <div className={cx('mx-auto grid max-w-5xl gap-6', plans.length >= 3 ? 'md:grid-cols-3' : plans.length === 2 ? 'md:grid-cols-2' : '')}>
          {plans.map((p) => (
            <div key={p.id} className={cx('relative flex flex-col rounded-card border bg-panel p-7',
              p.highlighted ? 'border-brand-600 shadow-lg ring-1 ring-brand-600' : 'border-line')}>
              {p.badge && <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-0.5 text-xs font-semibold text-brand-ink">{p.badge}</span>}
              <h2 className="font-display text-lg font-semibold text-ink">{p.name}</h2>
              {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
              <p className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold tracking-tight text-ink tabular-nums">{p.price}</span>
                {p.period && <span className="text-sm text-muted">{p.period}</span>}
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-ink">
                {p.features.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <svg aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <ActionButton action={{ variant: p.highlighted ? 'primary' : 'secondary', ...p.action }} className="mt-8 w-full" />
            </div>
          ))}
        </div>
        {footnote && <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted">{footnote}</p>}
      </Container>
    </div>
  );
}

/** About, FAQ, help, or any reading page. `toc` adds a sticky table of contents from the section titles. */
export function ProseArchetype({ eyebrow, title, intro, sections, toc = false, updated }:
  { eyebrow?: ReactNode; title: ReactNode; intro?: ReactNode; sections: { id: string; title: ReactNode; body: ReactNode }[]; toc?: boolean; updated?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="section-y">
      <Container width={toc ? 'default' : 'narrow'} className={cx(toc && 'grid gap-12 lg:grid-cols-[13rem_1fr]')}>
        {toc && (
          <nav aria-label={t('common.archetypes.onThisPage')} className="hidden lg:block">
            <div className="sticky top-24">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">{t('common.archetypes.onThisPage')}</p>
              <ul className="space-y-2 text-sm">
                {sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-muted hover:text-ink">{s.title}</a></li>)}
              </ul>
            </div>
          </nav>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>}
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
          {updated && <p className="mt-3 text-sm text-faint">{updated}</p>}
          {intro && <div className="prose-body mt-6 text-lg">{intro}</div>}
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="mt-12 scroll-mt-24">
              <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">{s.title}</h2>
              <div className="prose-body mt-4">{s.body}</div>
            </section>
          ))}
        </div>
      </Container>
    </div>
  );
}

/** Questions that open in place; native <details>, so it works without JavaScript. */
export function Faq({ items }: { items: { q: ReactNode; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-line rounded-card border border-line bg-panel">
      {items.map((it, i) => (
        <details key={i} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink">
            {it.q}
            <span aria-hidden className="text-faint transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-3 text-sm leading-relaxed text-muted">{it.a}</div>
        </details>
      ))}
    </div>
  );
}
