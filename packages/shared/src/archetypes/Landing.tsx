import type { ReactNode } from 'react';
import { ActionButton, Container, Media, Section, SectionHeader } from './parts';
import { COLS, cx } from './util';
import type { Action } from './parts';

/** The hero: the first screen of a landing page.
 *  - `split`: text left, image right (product, marketplace)
 *  - `centered`: text only, centered (tools, services)
 *  - `cover`: full-bleed image with text over it (galleries, travel, food)
 *  - `editorial`: oversized display type, image below (magazines, portfolios) */
export function Hero({ variant = 'split', eyebrow, title, subtitle, actions = [], image, imageAlt = '', aside }:
  { variant?: 'split' | 'centered' | 'cover' | 'editorial'; eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode;
    actions?: Action[]; image?: string | null; imageAlt?: string; aside?: ReactNode }) {
  const buttons = actions.length > 0 && (
    <div className={cx('mt-8 flex flex-wrap gap-3', variant === 'centered' && 'justify-center')}>
      {actions.map((a, i) => <ActionButton key={i} action={{ variant: i === 0 ? 'primary' : 'secondary', ...a }} size="lg" />)}
    </div>
  );
  const kicker = eyebrow && <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{eyebrow}</p>;

  if (variant === 'cover') {
    return (
      <section className="relative isolate min-h-[34rem] overflow-hidden bg-ink">
        {image && <img src={image} alt={imageAlt} className="absolute inset-0 -z-10 h-full w-full object-cover opacity-70" />}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
        <Container width="wide" className="flex min-h-[34rem] flex-col justify-end pb-16 pt-32 text-white">
          {eyebrow && <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/80">{eyebrow}</p>}
          <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight sm:text-6xl">{title}</h1>
          {subtitle && <p className="mt-5 max-w-xl text-lg text-white/85">{subtitle}</p>}
          {buttons}
        </Container>
      </section>
    );
  }

  if (variant === 'editorial') {
    return (
      <section className="section-y bg-surface">
        <Container width="wide">
          {kicker}
          <h1 className="max-w-5xl font-display text-5xl font-semibold leading-[1.02] tracking-tight text-ink sm:text-7xl">{title}</h1>
          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            {subtitle && <p className="max-w-2xl text-lg text-muted">{subtitle}</p>}
            {buttons}
          </div>
          {image && <Media src={image} alt={imageAlt} ratio="21/9" className="mt-12" />}
        </Container>
      </section>
    );
  }

  if (variant === 'centered') {
    return (
      <section className="section-y bg-surface">
        <Container width="narrow" className="text-center">
          {kicker}
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-6xl">{title}</h1>
          {subtitle && <p className="mx-auto mt-5 max-w-xl text-lg text-muted">{subtitle}</p>}
          {buttons}
          {aside && <div className="mt-12">{aside}</div>}
        </Container>
      </section>
    );
  }

  return (
    <section className="section-y bg-surface">
      <Container width="wide" className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          {kicker}
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-5 max-w-xl text-lg text-muted">{subtitle}</p>}
          {buttons}
        </div>
        {aside ?? (image !== undefined && <Media src={image} alt={imageAlt} ratio="5/4" />)}
      </Container>
    </section>
  );
}

export interface Feature {
  title: ReactNode;
  body: ReactNode;
  icon?: ReactNode;
}

/** Why-us / how-it-works points. `steps` numbers them (a process); `cards` boxes them. */
export function FeatureGrid({ eyebrow, title, subtitle, features, variant = 'plain', columns = 3, tone = 'panel' }:
  { eyebrow?: ReactNode; title?: ReactNode; subtitle?: ReactNode; features: Feature[]; variant?: 'plain' | 'cards' | 'steps';
    columns?: 2 | 3 | 4; tone?: 'surface' | 'panel' | 'raised' }) {
  return (
    <Section tone={tone}>
      {title && <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />}
      <div className={cx('grid section-gap sm:grid-cols-2', COLS[columns])}>
        {features.map((f, i) => (
          <div key={i} className={cx(variant === 'cards' && 'rounded-card border border-line bg-panel p-6')}>
            {variant === 'steps' ? (
              <div className="mb-3 font-display text-3xl font-semibold text-brand-600 tabular-nums">{String(i + 1).padStart(2, '0')}</div>
            ) : f.icon ? (
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-control bg-brand-50 text-brand-700">{f.icon}</div>
            ) : null}
            <h3 className="font-display text-lg font-semibold text-ink">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** A titled strip of records on a landing page ("New this week", "Popular"). `scroll` makes it a horizontal rail on
 *  small screens. */
export function Showcase<T>({ eyebrow, title, subtitle, action, items, renderItem, columns = 3, scroll = false, tone = 'surface' }:
  { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: Action; items: T[]; renderItem: (item: T) => ReactNode;
    columns?: 2 | 3 | 4; scroll?: boolean; tone?: 'surface' | 'panel' | 'raised' }) {
  return (
    <Section tone={tone} width="wide">
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} action={action && <ActionButton action={{ variant: 'ghost', ...action }} />} />
      {scroll ? (
        <div className="-mx-4 flex snap-x gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {items.map((it, i) => <div key={i} className="w-64 shrink-0 snap-start sm:w-auto">{renderItem(it)}</div>)}
        </div>
      ) : (
        <div className={cx('grid gap-6 sm:grid-cols-2', COLS[columns])}>{items.map((it, i) => <div key={i}>{renderItem(it)}</div>)}</div>
      )}
    </Section>
  );
}

/** Numbers that build trust ("12,000 recipes", "4.9 rating"). */
export function StatsBand({ stats, tone = 'raised' }: { stats: { value: ReactNode; label: ReactNode }[]; tone?: 'surface' | 'panel' | 'raised' }) {
  return (
    <Section tone={tone}>
      <dl className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
        {stats.map((s, i) => (
          <div key={i}>
            <dd className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{s.value}</dd>
            <dt className="mt-1 text-sm text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function Testimonials({ title, items }: { title?: ReactNode; items: { quote: ReactNode; name: ReactNode; role?: ReactNode }[] }) {
  return (
    <Section tone="panel">
      {title && <SectionHeader title={title} align="center" />}
      <div className="grid gap-6 md:grid-cols-3">
        {items.map((q, i) => (
          <figure key={i} className="rounded-card border border-line bg-surface p-6">
            <blockquote className="text-ink leading-relaxed">“{q.quote}”</blockquote>
            <figcaption className="mt-4 text-sm"><span className="font-semibold text-ink">{q.name}</span>{q.role && <span className="text-muted"> · {q.role}</span>}</figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

/** The closing call to action. */
export function CtaBand({ title, subtitle, actions, tone = 'brand' }:
  { title: ReactNode; subtitle?: ReactNode; actions: Action[]; tone?: 'brand' | 'ink' | 'raised' }) {
  const inverted = tone !== 'raised';
  return (
    <Section tone={tone}>
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h2 className={cx('font-display text-2xl font-semibold tracking-tight sm:text-3xl', !inverted && 'text-ink')}>{title}</h2>
          {subtitle && <p className={cx('mt-2', inverted ? 'opacity-85' : 'text-muted')}>{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          {actions.map((a, i) => (
            <ActionButton
              key={i}
              size="lg"
              action={a}
              className={inverted ? (i === 0 ? '!bg-panel !text-ink hover:!bg-raised' : '!border-current !bg-transparent !text-current') : undefined}
            />
          ))}
        </div>
      </div>
    </Section>
  );
}
