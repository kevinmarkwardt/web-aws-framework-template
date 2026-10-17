/* Example direction "Grid": Swiss and engineered. A visible grid with shared borders, mono labels and numbers, 2 px
   corners, ink buttons, color only for signals. Works for content and data alike: catalogs, docs, studios, tools. */
import type { ReactNode } from 'react';
import { Browse, Container, Detail, FeatureGrid, Hero, SiteHeader } from '@yourapp/shared/archetypes';
import { SAMPLE_CATEGORIES, SAMPLE_ITEMS, usd0 } from '../sample';
import type { SampleItem } from '../sample';
import { ramp } from '../types';
import type { Direction } from '../types';
import { HREF, SORTS, useSampleBrowse } from './shared';

const NAV = [{ label: 'Stays', href: HREF }, { label: 'Hosts', href: HREF }, { label: 'Pricing', href: HREF }];
const mono = 'font-mono text-xs text-muted';

function Header() {
  return (
    <SiteHeader
      brand={<><span aria-hidden className="h-3 w-3 bg-brand-600" /><span className="tracking-[0.14em]">FIELD/NOTES</span></>}
      nav={NAV}
      right={<a href={HREF} className="rounded-control bg-ink px-4 py-2 text-sm font-medium text-surface">Get started</a>}
    />
  );
}

/** One record in a shared-border grid cell. */
function Cell({ s, n }: { s: SampleItem; n: number }) {
  return (
    <a href={HREF} className="flex flex-col gap-3 bg-panel p-5 hover:bg-raised">
      <span className={`flex justify-between ${mono}`}><span>{String(n).padStart(2, '0')}</span><span>{s.category}</span></span>
      <img src={s.image} alt="" className="aspect-square w-full border border-line object-cover" />
      <span className="font-display text-base font-semibold leading-snug text-ink">{s.title}</span>
      <span className={`flex justify-between border-t border-line pt-2 ${mono}`}><span>{s.place.split(',')[0]}</span><span>{usd0(s.price)}</span></span>
    </a>
  );
}

function CellGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function Home() {
  const facts = [['Stays', '9'], ['Kinds', String(SAMPLE_CATEGORIES.length)], ['Booking fee', '$0'], ['Hosts', '9']];
  return (
    <>
      <Header />
      <Container width="wide" className="border-x border-line !px-0">
        <div className="flex flex-wrap">
          <div className="min-w-0 flex-[3_1_36rem] border-r border-line">
            <Hero variant="editorial" eyebrow="01 / Field notes" title="Small places, listed plainly." subtitle="Nine stays with the facts up front: where, how much, how long. Booked direct, no fees."
              actions={[{ label: 'Browse stays', href: HREF }, { label: 'How it works', href: HREF }]} />
          </div>
          <dl className="grid min-w-0 flex-[1_1_16rem] content-stretch">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-col justify-end gap-1 border-b border-line px-6 py-5">
                <dt className={mono}>{k}</dt>
                <dd className="text-3xl font-medium tracking-tight text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
      <section className="section-y border-t border-line-strong bg-panel">
        <Container width="wide">
          <h2 className="mb-6 font-display text-xl font-semibold text-ink"><span className={`${mono} mr-3`}>02</span>Stays</h2>
          <CellGrid>{SAMPLE_ITEMS.slice(0, 4).map((s, i) => <Cell key={s.id} s={s} n={i + 1} />)}</CellGrid>
        </Container>
      </section>
      <FeatureGrid
        variant="steps"
        tone="surface"
        eyebrow="03 / Rules"
        title="How a stay gets listed"
        features={[
          { title: 'Somebody stays first', body: 'Nothing is listed until one of us has spent a night there.' },
          { title: 'The host answers', body: 'Every place is run by the person who replies to your message.' },
          { title: 'Facts, then words', body: 'Price, nights and rules come before the description.' },
        ]}
      />
    </>
  );
}

function BrowsePage() {
  const b = useSampleBrowse(8);
  return (
    <>
      <Header />
      <Browse
        title="Stays"
        query={b.query} onQuery={b.onQuery}
        filters={[{ id: 'category', label: 'Kind', options: SAMPLE_CATEGORIES.map((c) => ({ value: c, label: c })), value: b.category, onChange: b.onCategory }]}
        sort={b.sort} sortOptions={SORTS} onSort={b.onSort}
        columns={4}
        items={b.items} itemKey={(s) => s.id}
        renderCard={(s) => <Cell s={s} n={SAMPLE_ITEMS.indexOf(s) + 1} />}
        total={b.total} page={b.page} pageSize={b.pageSize} onPage={b.onPage}
      />
    </>
  );
}

function DetailPage() {
  const s = SAMPLE_ITEMS[8];
  return (
    <>
      <Header />
      <Detail
        variant="document"
        crumbs={[{ label: 'Stays', href: HREF }, { label: s.title }]}
        eyebrow={`${s.category} / ${s.place}`}
        title={s.title}
        subtitle={s.summary}
        facts={[{ label: 'Price', value: `${usd0(s.price)} / night` }, { label: 'Minimum', value: `${s.nights} nights` }, { label: 'Rating', value: s.rating.toFixed(2) }, { label: 'Host', value: s.host }]}
        body={<><img src={s.image} alt="" className="aspect-[3/2] w-full border border-line object-cover" /><p>{s.summary} The tower sleeps two, with a stove, a cistern sink and a composting toilet at the foot of the stairs.</p></>}
        actions={<a href={HREF} className="block rounded-control bg-ink py-3 text-center font-medium text-surface">Reserve</a>}
        related={{ title: 'Also listed', content: <CellGrid>{SAMPLE_ITEMS.slice(0, 4).map((r, i) => <Cell key={r.id} s={r} n={i + 1} />)}</CellGrid> }}
      />
    </>
  );
}

export const grid: Direction = {
  id: 'grid',
  name: 'Grid',
  idea: 'Swiss and engineered: a visible grid with shared borders, mono labels, 2 px corners, color only for signals.',
  fonts: ['IBM Plex Sans:wght@400;500;600;700', 'IBM Plex Mono:wght@400;500'],
  tokens: {
    surface: 'oklch(98.4% 0.002 250)', panel: 'oklch(100% 0 0)', raised: 'oklch(94.5% 0.003 250)',
    ink: 'oklch(17% 0.005 250)', muted: 'oklch(43% 0.006 250)', faint: 'oklch(51% 0.006 250)',
    line: 'oklch(88.5% 0.004 250)', 'line-strong': 'oklch(76% 0.005 250)',
    ...ramp('oklch(64% 0.2 40)'), 'brand-700': 'oklch(51% 0.18 38)', 'brand-ink': 'oklch(17% 0.005 250)',
    'typeface-display': '"IBM Plex Sans", system-ui, sans-serif', 'typeface-body': '"IBM Plex Sans", system-ui, sans-serif',
    'typeface-mono': '"IBM Plex Mono", ui-monospace, monospace',
    'corner-card': '0.125rem', 'corner-control': '0.125rem', density: '1',
  },
  dark: {
    surface: 'oklch(15.5% 0.003 250)', panel: 'oklch(19% 0.004 250)', raised: 'oklch(23.5% 0.004 250)',
    ink: 'oklch(95% 0.002 250)', muted: 'oklch(73% 0.005 250)', faint: 'oklch(63% 0.005 250)',
    line: 'oklch(29% 0.005 250)', 'line-strong': 'oklch(42% 0.006 250)',
    'brand-600': 'oklch(70% 0.17 45)', 'brand-700': 'oklch(76% 0.14 48)', 'brand-50': 'oklch(28% 0.05 45)',
  },
  pages: { home: Home, browse: BrowsePage, detail: DetailPage },
};
