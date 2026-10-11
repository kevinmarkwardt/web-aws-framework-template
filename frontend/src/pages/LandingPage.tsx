/* The public landing page (the template's demo product: change monitoring for "Items"). Layout: a split hero with a
   live product demo, then sections with a sticky text column beside working demos that animate while on screen
   (pages/landing/demos.tsx), a details index, pricing from the API, FAQ and one closing call to action. Built on the
   archetypes and theme tokens, so a design direction restyles it; a generated site rewrites the copy in landing.json. */
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from '@yourapp/shared';
import { ActionButton, Container, CtaBand, Faq, Reveal, SiteHeader } from '@yourapp/shared/archetypes';
import SiteFooter from '../components/SiteFooter';
import { creditsOn, subscriptionsOn, units, usd, usePublicConfig } from '../billing';
import { itemsLabel } from '../plans';
import { SITE } from '../site';
import { AddDemo, DiffDemo, DigestDemo, LiveMonitor, ScheduleDemo } from './landing/demos';

const eyebrow = 'font-mono text-xs uppercase tracking-[0.12em] text-brand-700';

/** A section with its heading in a column that stays put while the content beside it scrolls (wide screens). */
function SplitSection({ id, kicker, title, body, children, tone = 'surface' }:
  { id?: string; kicker: string; title: string; body?: string; children: ReactNode; tone?: 'surface' | 'panel' }) {
  return (
    <section id={id} className={`scroll-mt-16 border-t border-line ${tone === 'panel' ? 'bg-panel' : 'bg-surface'}`}>
      <Container width="wide" className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="py-12 lg:sticky lg:top-16 lg:self-start lg:py-20 lg:pr-12">
          <Reveal>
            <p className={eyebrow}>{kicker}</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink text-balance sm:text-4xl">{title}</h2>
            {body && <p className="mt-4 max-w-md text-muted">{body}</p>}
          </Reveal>
        </div>
        <div className="pb-12 lg:border-l lg:border-line lg:py-20 lg:pl-12">{children}</div>
      </Container>
    </section>
  );
}

function BrandMark() {
  return (
    <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 13h3l2-5 2 9 2-4h1" />
    </svg>
  );
}

export default function LandingPage() {
  // Plans, prices, limits and credit packs come from the API (api/lib/config.py; limits are admin-editable). The
  // pricing section shows the billing modules that are on, and nothing until the API answers.
  const config = usePublicConfig();
  const plans = subscriptionsOn(config?.billingMode) ? config?.plans ?? [] : [];
  const credits = creditsOn(config?.billingMode) ? config?.credits : undefined;
  const freeLimit = config?.planLimits?.free;
  const { t } = useTranslation();
  const hasPricing = plans.length > 0 || !!credits;
  const details = t('landing.details.items', { returnObjects: true }) as { t: string; d: string }[];
  const faq = t('landing.faq.items', { returnObjects: true }) as { q: string; a: string }[];

  const steps = [
    { key: 'add', demo: <AddDemo /> },
    { key: 'schedule', demo: <ScheduleDemo /> },
    { key: 'alerts', demo: <DiffDemo /> },
    { key: 'digest', demo: <DigestDemo /> },
  ];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <SiteHeader
        brand={<><BrandMark /> {SITE.displayName}</>}
        nav={[
          { label: t('landing.nav.how'), href: '#how' },
          ...(hasPricing ? [{ label: t('landing.nav.pricing'), href: '#pricing' }] : []),
          { label: t('landing.nav.faq'), href: '#faq' },
        ]}
        right={
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-muted hover:text-ink">{t('landing.nav.login')}</Link>
            <ActionButton action={{ label: t('landing.getStarted'), href: '/signup' }} />
          </div>
        }
      />

      {/* Hero: the offer on the left, the product working on the right */}
      <section className="border-b border-line">
        <Container width="wide" className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col justify-end gap-6 py-14 lg:min-h-[34rem] lg:py-20 lg:pr-12">
            <Reveal><p className={eyebrow}>{t('landing.hero.eyebrow')}</p></Reveal>
            <Reveal delay={80}>
              <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink text-balance sm:text-5xl">{t('landing.hero.title')}</h1>
            </Reveal>
            <Reveal delay={160}><p className="max-w-md text-lg text-muted">{t('landing.hero.body')}</p></Reveal>
            <Reveal delay={240} className="flex flex-wrap items-center gap-3">
              <ActionButton size="lg" action={{ label: t('landing.getStarted'), href: '/signup' }} />
              <a href="#how" className="inline-flex h-12 items-center rounded-control border border-line-strong bg-panel px-5 font-medium text-ink hover:bg-raised">
                {t('landing.hero.secondary')}
              </a>
            </Reveal>
            <Reveal delay={320}>
              <p className="text-sm text-faint">
                {freeLimit !== undefined && t('landing.hero.freeIncludes', { items: itemsLabel(freeLimit).toLowerCase() })}
                {t('landing.hero.noCard')}
              </p>
            </Reveal>
          </div>
          <div className="flex items-center pb-14 lg:border-l lg:border-line lg:py-20 lg:pl-12">
            <Reveal delay={200} y={24} className="w-full"><LiveMonitor /></Reveal>
          </div>
        </Container>
      </section>

      <SplitSection id="how" kicker={t('landing.how.eyebrow')} title={t('landing.how.title')} body={t('landing.how.body')}>
        <div className="space-y-16">
          {steps.map((s, i) => (
            <Reveal key={s.key} className="grid gap-5">
              <div>
                <p className="font-mono text-xs text-faint tabular-nums">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="mt-1 font-display text-xl font-semibold text-ink">{t(`landing.how.${s.key}.title`)}</h3>
                <p className="mt-2 max-w-lg text-muted">{t(`landing.how.${s.key}.desc`)}</p>
              </div>
              {s.demo}
            </Reveal>
          ))}
        </div>
      </SplitSection>

      <SplitSection kicker={t('landing.details.eyebrow')} title={t('landing.details.title')} tone="panel">
        <dl className="grid gap-x-10 sm:grid-cols-2">
          {details.map((d, i) => (
            <Reveal key={d.t} delay={(i % 2) * 80} className="border-t border-line py-5">
              <dt className="font-medium text-ink">{d.t}</dt>
              <dd className="mt-1 text-sm text-muted">{d.d}</dd>
            </Reveal>
          ))}
        </dl>
      </SplitSection>

      {hasPricing && (
        <SplitSection id="pricing" kicker={t('landing.pricing.eyebrow')} title={t('landing.pricing.title')} body={t('landing.pricing.subtitle')}>
          {plans.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan, i) => (
                <Reveal key={plan.id} delay={i * 80} className={`flex flex-col rounded-card border bg-panel p-6 ${i === 1 ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line'}`}>
                  <h3 className="font-medium text-ink">{plan.name}</h3>
                  <p className="mt-3 flex items-baseline gap-1.5">
                    <span className="font-display text-4xl font-semibold tracking-tight text-ink tabular-nums">{t('landing.pricing.price', { amount: plan.monthlyUsd })}</span>
                    <span className="text-sm text-muted">{t('landing.pricing.perMonth')}</span>
                  </p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm text-ink">
                    {[itemsLabel(plan.limits.items ?? null), ...(plan.features ?? [])].map((f) => (
                      <li key={f} className="flex gap-2">
                        <svg aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <ActionButton className="mt-6 w-full"
                    action={{ label: plan.monthlyUsd === 0 ? t('landing.pricing.startFree') : t('landing.pricing.choose', { plan: plan.name }), href: '/signup', variant: i === 1 ? 'primary' : 'secondary' }} />
                </Reveal>
              ))}
            </div>
          )}
          {credits && (
            <Reveal className={plans.length > 0 ? 'mt-10 border-t border-line pt-8' : ''}>
              <h3 className="font-display text-xl font-semibold text-ink">{t('landing.pricing.payg.title')}</h3>
              <p className="mt-2 max-w-xl text-muted">
                {credits.signupGift > 0
                  ? t('landing.pricing.payg.buyWithGift', { credits: credits.creditName, perDollar: credits.perDollar, gift: units(credits.signupGift, credits.creditName) })
                  : t('landing.pricing.payg.buy', { credits: credits.creditName, perDollar: credits.perDollar })}{' '}
                {t('landing.pricing.payg.refund', { credits: credits.creditName, count: credits.refundDays })}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {credits.packs.map((p) => (
                  <div key={p.id} className="rounded-card border border-line bg-panel px-5 py-3">
                    <p className="font-semibold text-ink tabular-nums">{usd(p.payCents)}</p>
                    <p className="text-sm text-muted">{units(p.credits, credits.creditName)}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          )}
        </SplitSection>
      )}

      <SplitSection id="faq" kicker={t('landing.faq.eyebrow')} title={t('landing.faq.title')} tone="panel">
        <Reveal><Faq items={faq.map((f) => ({ q: f.q, a: f.a }))} /></Reveal>
      </SplitSection>

      <CtaBand tone="ink" title={t('landing.cta.title')} subtitle={t('landing.cta.body')} actions={[{ label: t('landing.getStarted'), href: '/signup' }]} />

      <SiteFooter />
    </div>
  );
}
