/* Example direction "Catalog": a tool for finding things fast. Solid top bar, search-led hero, filters in a side column,
   dense cards with the numbers up front, product-style detail. For marketplaces, directories, inventories. */
import { Browse, DashboardPanel, Detail, EntityCard, FeatureGrid, Hero, Showcase, SiteHeader, StatsBand, Tag } from '@yourapp/shared/archetypes';
import { SAMPLE_CATEGORIES, SAMPLE_ITEMS, usd0 } from '../sample';
import { ramp } from '../types';
import type { Direction } from '../types';
import { HREF, SORTS, useSampleBrowse } from './shared';

const NAV = [{ label: 'Browse', href: HREF }, { label: 'Hosts', href: HREF }, { label: 'Pricing', href: HREF }];

function Header() {
  return (
    <SiteHeader
      brand={<><span className="grid h-7 w-7 place-items-center rounded-control bg-brand-600 text-sm font-bold text-brand-ink">S</span> Staybook</>}
      nav={NAV}
      right={<div className="flex items-center gap-2"><a href={HREF} className="text-sm font-medium text-muted hover:text-ink">Sign in</a><a href={HREF} className="rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-brand-ink">List a place</a></div>}
    />
  );
}

const rating = (r: number) => <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">★ {r.toFixed(2)}</span>;

function Card({ s }: { s: (typeof SAMPLE_ITEMS)[number] }) {
  return (
    <EntityCard
      href={HREF}
      image={s.image}
      imageRatio="16/10"
      title={s.title}
      subtitle={s.place}
      badge={<Tag tone="brand">{s.category}</Tag>}
      footer={<div className="flex items-center justify-between"><span className="text-sm text-ink"><b className="font-semibold">{usd0(s.price)}</b> <span className="text-muted">night</span></span>{rating(s.rating)}</div>}
    />
  );
}

function Home() {
  return (
    <>
      <Header />
      <Hero
        variant="split"
        eyebrow="1,240 verified stays"
        title="Find a place that fits the trip."
        subtitle="Filter by what matters: price, nights, the kind of place. Every host verified, every price final."
        actions={[{ label: 'Browse stays', href: HREF }, { label: 'How verification works', href: HREF, variant: 'ghost' }]}
        aside={
          <DashboardPanel title="Quick search">
            <div className="grid gap-3 sm:grid-cols-2">
              {['Where', 'Kind of place', 'Check in', 'Guests'].map((l) => (
                <label key={l} className="block text-xs font-medium uppercase tracking-wide text-faint">{l}
                  <div className="mt-1 rounded-control border border-line bg-surface px-3 py-2 text-sm normal-case tracking-normal text-muted">Any</div>
                </label>
              ))}
            </div>
            <a href={HREF} className="mt-4 block rounded-control bg-brand-600 py-2.5 text-center text-sm font-medium text-brand-ink">Search 1,240 stays</a>
          </DashboardPanel>
        }
      />
      <StatsBand stats={[{ value: '1,240', label: 'stays' }, { value: '4.82', label: 'average rating' }, { value: '$0', label: 'booking fees' }, { value: '24 h', label: 'host reply time' }]} />
      <Showcase title="Top rated this month" action={{ label: 'See all', href: HREF }} columns={4} items={SAMPLE_ITEMS.slice(0, 4)} renderItem={(s) => <Card s={s} />} />
      <FeatureGrid
        variant="cards"
        columns={3}
        tone="surface"
        title="Built for planning"
        features={[
          { title: 'Real availability', body: 'Calendars sync with hosts every 15 minutes.' },
          { title: 'Final prices', body: 'Cleaning and taxes are in the number you see.' },
          { title: 'Compare side by side', body: 'Save stays to a list and line them up.' },
        ]}
      />
    </>
  );
}

function BrowsePage() {
  const b = useSampleBrowse(6);
  return (
    <>
      <Header />
      <Browse
        title="Stays"
        filtersAt="side"
        query={b.query} onQuery={b.onQuery} searchPlaceholder="Search by name or town"
        filters={[{ id: 'category', label: 'Kind of place', multi: true, value: b.category, onChange: b.onCategory,
          options: SAMPLE_CATEGORIES.map((c) => ({ value: c, label: c, count: SAMPLE_ITEMS.filter((s) => s.category === c).length })) }]}
        sort={b.sort} sortOptions={SORTS} onSort={b.onSort}
        view={b.view} onView={b.onView} columns={3}
        items={b.items} itemKey={(s) => s.id}
        renderCard={(s) => <Card s={s} />}
        renderRow={(s) => (
          <div className="flex items-center gap-4 py-3">
            <img src={s.image} alt="" className="h-14 w-20 rounded-control object-cover" />
            <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink">{s.title}</p><p className="text-sm text-muted">{s.place} · {s.category}</p></div>
            {rating(s.rating)}
            <span className="w-20 text-right font-semibold text-ink tabular-nums">{usd0(s.price)}</span>
          </div>
        )}
        total={b.total} page={b.page} pageSize={b.pageSize} onPage={b.onPage}
      />
    </>
  );
}

function DetailPage() {
  const s = SAMPLE_ITEMS[0];
  return (
    <>
      <Header />
      <Detail
        variant="split"
        crumbs={[{ label: 'Stays', href: HREF }, { label: s.category, href: HREF }, { label: s.title }]}
        title={s.title}
        subtitle={s.place}
        badges={<><Tag tone="brand">{s.category}</Tag><Tag>Verified host</Tag></>}
        image={s.image}
        gallery={SAMPLE_ITEMS.slice(0, 4).map((x) => x.image)}
        facts={[{ label: 'Price', value: `${usd0(s.price)} / night` }, { label: 'Minimum', value: `${s.nights} nights` }, { label: 'Rating', value: s.rating.toFixed(2) }, { label: 'Host', value: s.host }, { label: 'Sleeps', value: '4' }, { label: 'Pets', value: 'Allowed' }]}
        actions={
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-control border border-line p-2"><p className="text-xs text-faint">Check in</p><p className="text-ink">Oct 24</p></div>
              <div className="rounded-control border border-line p-2"><p className="text-xs text-faint">Check out</p><p className="text-ink">Oct 26</p></div>
            </div>
            <div className="flex justify-between text-sm text-muted"><span>{usd0(s.price)} × 2 nights</span><span className="text-ink">{usd0(s.price * 2)}</span></div>
            <a href={HREF} className="block rounded-control bg-brand-600 py-2.5 text-center text-sm font-semibold text-brand-ink">Reserve</a>
          </div>
        }
        body={<p>{s.summary} The cabin sleeps four across a queen loft and a pull-out, with a full kitchen and a covered porch facing west.</p>}
        related={{ title: 'Similar stays', content: <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">{SAMPLE_ITEMS.slice(4, 8).map((r) => <Card key={r.id} s={r} />)}</div> }}
      />
    </>
  );
}

export const catalog: Direction = {
  id: 'catalog',
  name: 'Catalog',
  idea: 'A finding tool: search first, side filters, dense cards with price and rating up front, product-style pages.',
  fonts: ['Inter:wght@400..700'],
  tokens: {
    surface: '#f6f8fa', panel: '#ffffff', raised: '#eef2f6', ink: '#0f172a', muted: '#475569', faint: '#64748b', line: '#e2e8f0',
    ...ramp('#0f6fde'), 'brand-ink': '#ffffff',
    'typeface-display': '"Inter", system-ui, sans-serif', 'typeface-body': '"Inter", system-ui, sans-serif',
    'corner-card': '0.625rem', 'corner-control': '0.5rem', density: '0.85',
  },
  dark: { surface: '#0b1220', panel: '#111a2b', raised: '#18233a', ink: '#e6edf7', muted: '#a3b1c6', faint: '#7a8aa3', line: '#22304a', 'brand-50': '#0f2747' },
  pages: { home: Home, browse: BrowsePage, detail: DetailPage },
};
