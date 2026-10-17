import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs, Container, ErrorState, Media, MetaList } from './parts';
import { cx } from './util';
import type { Crumb, Meta } from './parts';

/** One record's page.
 *  - `split`: media left, facts and actions right (products, listings)
 *  - `stacked`: wide media on top, reading column below with a sticky action box (articles, recipes, places)
 *  - `document`: no media, a reading column with a facts sidebar (profiles, reports, records) */
export function Detail({
  variant = 'split', crumbs, eyebrow, title, subtitle, badges, image, imageAlt, gallery,
  facts, body, actions, aside, related, loading, error, notFound,
}: {
  variant?: 'split' | 'stacked' | 'document';
  crumbs?: Crumb[]; eyebrow?: ReactNode; title?: ReactNode; subtitle?: ReactNode; badges?: ReactNode;
  image?: string | null; imageAlt?: string; gallery?: (string | null)[];
  /** label/value facts (price, duration, author...) */
  facts?: Meta[];
  /** the long content */
  body?: ReactNode;
  /** primary actions (buy, unlock, save), shown in the action box */
  actions?: ReactNode;
  /** extra content under the actions (seller card, map, notes) */
  aside?: ReactNode;
  related?: { title: ReactNode; content: ReactNode };
  loading?: boolean; error?: ReactNode; notFound?: boolean;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Container width="wide" className="section-y">
        <div aria-busy aria-label={t('common.loading')} className="grid animate-pulse gap-10 lg:grid-cols-2">
          <div className="aspect-[4/3] rounded-card bg-raised" />
          <div className="space-y-4"><div className="h-8 w-2/3 rounded bg-raised" /><div className="h-4 w-1/2 rounded bg-raised" /><div className="h-32 rounded bg-raised" /></div>
        </div>
      </Container>
    );
  }
  if (notFound) {
    return (
      <Container width="narrow" className="section-y text-center">
        <p className="font-display text-2xl font-semibold text-ink">{t('common.archetypes.notFound')}</p>
        <p className="mt-2 text-muted">{t('common.archetypes.notFoundBody')}</p>
        {crumbs?.[0]?.href && <a href={crumbs[0].href} className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline">{t('common.archetypes.back')}</a>}
      </Container>
    );
  }
  if (error) return <Container width="narrow" className="section-y"><ErrorState message={error} /></Container>;

  const heading = (
    <div>
      {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</p>}
      <h1 className={cx('font-display font-semibold tracking-tight text-ink', variant === 'stacked' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl')}>{title}</h1>
      {subtitle && <p className="mt-3 text-lg text-muted">{subtitle}</p>}
      {badges && <div className="mt-4 flex flex-wrap gap-2">{badges}</div>}
    </div>
  );
  const actionBox = (actions || aside) && (
    <div className="space-y-4 lg:sticky lg:top-24">
      {actions && <div className="rounded-card border border-line bg-panel p-5">{actions}</div>}
      {aside}
    </div>
  );
  const thumbs = gallery && gallery.length > 1 && (
    <div className="mt-3 grid grid-cols-4 gap-3">
      {gallery.slice(0, 4).map((g, i) => <Media key={i} src={g} alt="" ratio="1/1" />)}
    </div>
  );

  return (
    <article className="section-y">
      <Container width="wide">
        {crumbs && <Breadcrumbs items={crumbs} />}
        {variant === 'split' && (
          <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <Media src={image} alt={imageAlt ?? (typeof title === 'string' ? title : '')} ratio="4/3" />
              {thumbs}
            </div>
            <div className="space-y-6">
              {heading}
              {facts && facts.length > 0 && <div className="border-y border-line py-5"><MetaList items={facts} /></div>}
              {actionBox}
            </div>
          </div>
        )}
        {variant === 'stacked' && (
          <>
            {heading}
            {image !== undefined && <Media src={image} alt={imageAlt ?? ''} ratio="21/9" className="mt-8" />}
            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_20rem]">
              <div className="min-w-0">
                {facts && facts.length > 0 && <div className="mb-8 border-b border-line pb-6"><MetaList items={facts} /></div>}
                {body && <div className="prose-body">{body}</div>}
              </div>
              {actionBox}
            </div>
          </>
        )}
        {variant === 'document' && (
          <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
            <div className="min-w-0">
              {heading}
              {body && <div className="prose-body mt-8">{body}</div>}
            </div>
            <div className="space-y-4">
              {facts && facts.length > 0 && <div className="rounded-card border border-line bg-panel p-5"><MetaList items={facts} /></div>}
              {actionBox}
            </div>
          </div>
        )}
        {variant === 'split' && body && <div className="prose-body mt-12 max-w-3xl">{body}</div>}
        {related && (
          <section className="mt-16 border-t border-line pt-10">
            <h2 className="mb-6 font-display text-xl font-semibold text-ink">{related.title}</h2>
            {related.content}
          </section>
        )}
      </Container>
    </article>
  );
}
