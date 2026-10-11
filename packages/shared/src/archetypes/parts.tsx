/** Building blocks the page archetypes share. Styled only with theme tokens (theme.css), so a design direction or a
 *  reskin restyles them without touching this file. Every text a visitor reads comes in through props or t(). */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { COLS, cx } from './util';

/** Internal paths ("/x") use the router; anything else is a plain link. */
export function SmartLink({ href, className, children, ...rest }:
  { href: string; className?: string; children: ReactNode; 'aria-label'?: string }) {
  if (href.startsWith('/')) return <Link to={href} className={className} {...rest}>{children}</Link>;
  return <a href={href} className={className} {...rest}>{children}</a>;
}

export type Width = 'narrow' | 'default' | 'wide' | 'full';
const WIDTHS: Record<Width, string> = { narrow: 'max-w-3xl', default: 'max-w-6xl', wide: 'max-w-7xl', full: 'max-w-none' };

export function Container({ width = 'default', className, children }: { width?: Width; className?: string; children: ReactNode }) {
  return <div className={cx('mx-auto w-full px-4 sm:px-6 lg:px-8', WIDTHS[width], className)}>{children}</div>;
}

/** A vertical band of the page. `tone` picks the background from the tokens. */
export function Section({ tone = 'surface', width, className, id, children }:
  { tone?: 'surface' | 'panel' | 'raised' | 'brand' | 'ink'; width?: Width; className?: string; id?: string; children: ReactNode }) {
  const bg = { surface: 'bg-surface', panel: 'bg-panel', raised: 'bg-raised', brand: 'bg-brand-600 text-brand-ink', ink: 'bg-ink text-surface' }[tone];
  return (
    <section id={id} className={cx('section-y', bg, className)}>
      <Container width={width}>{children}</Container>
    </section>
  );
}

export function SectionHeader({ eyebrow, title, subtitle, action, align = 'left' }:
  { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; align?: 'left' | 'center' }) {
  return (
    <div className={cx('mb-8 flex flex-wrap items-end gap-4', align === 'center' ? 'flex-col items-center text-center' : 'justify-between')}>
      <div className={cx(align === 'center' && 'max-w-2xl')}>
        {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>}
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export interface Action {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}

const ACTION: Record<NonNullable<Action['variant']>, string> = {
  primary: 'bg-brand-600 text-brand-ink hover:bg-brand-700',
  secondary: 'border border-line bg-panel text-ink hover:bg-raised',
  ghost: 'text-ink hover:bg-raised',
};

export function ActionButton({ action, size = 'md', className }: { action: Action; size?: 'md' | 'lg'; className?: string }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50',
    size === 'lg' ? 'px-5 py-3 text-base' : 'px-4 py-2 text-sm',
    ACTION[action.variant ?? 'primary'],
    className,
  );
  if (action.href && !action.disabled) return <SmartLink href={action.href} className={cls}>{action.label}</SmartLink>;
  return <button type="button" className={cls} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>;
}

/** An image that never breaks the layout: a fixed aspect box, and a soft placeholder when there's no image or it
 *  fails to load. */
export function Media({ src, alt, ratio = '4/3', className, rounded = true }:
  { src?: string | null; alt: string; ratio?: string; className?: string; rounded?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cx('relative overflow-hidden bg-raised', rounded && 'rounded-card', className)} style={{ aspectRatio: ratio }}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div aria-hidden className="absolute inset-0 grid place-items-center text-faint">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A1.5 1.5 0 0 0 21.75 19.5V4.5A1.5 1.5 0 0 0 20.25 3H3.75A1.5 1.5 0 0 0 2.25 4.5v15A1.5 1.5 0 0 0 3.75 21Z" />
          </svg>
        </div>
      )}
    </div>
  );
}

export interface Meta {
  label: ReactNode;
  value: ReactNode;
}

/** Label/value pairs: `inline` for a card's footer, `grid` for a detail page's facts. */
export function MetaList({ items, layout = 'grid' }: { items: Meta[]; layout?: 'grid' | 'inline' }) {
  if (layout === 'inline') {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {items.map((m, i) => <span key={i}><span className="sr-only">{m.label}: </span>{m.value}</span>)}
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      {items.map((m, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-faint">{m.label}</dt>
          <dd className="mt-1 text-sm text-ink">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      tone === 'brand' ? 'bg-brand-50 text-brand-700' : 'bg-raised text-muted')}>
      {children}
    </span>
  );
}

export interface Crumb {
  label: ReactNode;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('common.archetypes.breadcrumbs')} className="mb-4 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-faint">/</span>}
            {c.href ? <SmartLink href={c.href} className="hover:text-ink">{c.label}</SmartLink> : <span className="text-ink">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Card for one record in a grid. The whole card is the link. */
export function EntityCard({ href, image, imageRatio = '4/3', title, subtitle, meta, badge, footer, layout = 'stacked' }:
  { href?: string; image?: string | null; imageRatio?: string; title: ReactNode; subtitle?: ReactNode; meta?: Meta[];
    badge?: ReactNode; footer?: ReactNode; layout?: 'stacked' | 'overlay' | 'text' }) {
  const alt = typeof title === 'string' ? title : '';
  const body = layout === 'overlay' ? (
    <div className="relative">
      <Media src={image} alt={alt} ratio={imageRatio} />
      <div className="absolute inset-x-0 bottom-0 rounded-b-card bg-gradient-to-t from-black/75 to-transparent p-4 pt-12 text-white">
        {badge && <div className="mb-2">{badge}</div>}
        <h3 className="font-display text-lg font-semibold leading-snug line-clamp-2">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-white/80 line-clamp-1">{subtitle}</p>}
      </div>
    </div>
  ) : (
    <div className={cx('flex h-full flex-col', layout === 'text' && 'rounded-card border border-line bg-panel p-5')}>
      {layout === 'stacked' && <Media src={image} alt={alt} ratio={imageRatio} className="mb-3" />}
      {badge && <div className="mb-2">{badge}</div>}
      <h3 className="font-display text-base font-semibold leading-snug text-ink line-clamp-2 group-hover:text-brand-700">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-muted line-clamp-2">{subtitle}</p>}
      {meta && meta.length > 0 && <div className="mt-2"><MetaList items={meta} layout="inline" /></div>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </div>
  );
  if (!href) return <article className="group">{body}</article>;
  return (
    <article className="group">
      <SmartLink href={href} className="block h-full rounded-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500">{body}</SmartLink>
    </article>
  );
}

/** One record as a row in a list: thumbnail, text, and a trailing slot (price, status, action). Browse puts each row
 *  in an <li> with dividers between them. */
export function EntityRow({ href, image, title, subtitle, meta, trailing }:
  { href?: string; image?: string | null; title: ReactNode; subtitle?: ReactNode; meta?: Meta[]; trailing?: ReactNode }) {
  const alt = typeof title === 'string' ? title : '';
  const inner = (
    <div className="flex items-center gap-4 py-4">
      {image !== undefined && <Media src={image} alt={alt} ratio="1/1" className="w-16 shrink-0 sm:w-20" />}
      <div className="min-w-0 flex-1">
        <h3 className="font-display font-semibold text-ink truncate group-hover:text-brand-700">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted line-clamp-1">{subtitle}</p>}
        {meta && meta.length > 0 && <div className="mt-1"><MetaList items={meta} layout="inline" /></div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
    </div>
  );
  return (
    <div className="group">
      {href ? <SmartLink href={href} className="block focus-visible:outline-2 focus-visible:outline-brand-500">{inner}</SmartLink> : inner}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: Action; icon?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-panel px-6 py-14 text-center">
      {icon && <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-raised text-muted">{icon}</div>}
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-5"><ActionButton action={action} /></div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: ReactNode; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="rounded-card border border-danger/30 bg-danger-soft px-6 py-10 text-center">
      <p className="font-semibold text-danger">{message ?? t('common.archetypes.errorTitle')}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-ink underline underline-offset-4">
          {t('common.archetypes.retry')}
        </button>
      )}
    </div>
  );
}

/** Placeholder grid while a list loads, the same shape as the cards. */
export function SkeletonGrid({ count = 6, columns = 3 }: { count?: number; columns?: 2 | 3 | 4 }) {
  const { t } = useTranslation();
  return (
    <div aria-busy aria-label={t('common.loading')} className={cx('grid gap-6 sm:grid-cols-2', COLS[columns])}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[4/3] rounded-card bg-raised" />
          <div className="mt-3 h-4 w-3/4 rounded bg-raised" />
          <div className="mt-2 h-3 w-1/2 rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}
