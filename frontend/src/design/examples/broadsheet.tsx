/* Example direction "Broadsheet": editorial. A masthead with a rule under it, oversized serif headlines, a numbered
   index instead of cards, a reading column on detail pages. For sites where the content is the product (recipes,
   guides, travel). */
import { Browse, Container, CtaBand, Detail, EntityCard, EntityRow, FeatureGrid, Hero, SiteHeader, Tag } from '@yourapp/shared/archetypes';
import { SAMPLE_CATEGORIES, SAMPLE_ITEMS, art, usd0 } from '../sample';
import { ramp } from '../types';
import type { Direction } from '../types';
import { HREF, SORTS, useSampleBrowse } from './shared';

const NAV = [{ label: 'Stays', href: HREF }, { label: 'Journal', href: HREF }, { label: 'About', href: HREF }];

function Header() {
  return (
    <div className="border-b-[3px] border-double border-ink">
      <SiteHeader variant="centered" sticky={false} brand="Field Notes" nav={NAV} right={<a href={HREF} className="text-sm font-medium text-ink underline underline-offset-4">Sign in</a>} />
    </div>
  );
}

function Home() {
  return (
    <>
      <Header />
      <Hero
        variant="editorial"
        eyebrow="Issue 14 · Autumn"
        title="Small places, chosen slowly."
        subtitle="Nine stays we would go back to, each picked after a night under its roof. Booked direct, no fees."
        actions={[{ label: 'Read the issue', href: HREF }, { label: 'How we choose', href: HREF }]}
        image={art(11, 1600, 700)}
      />
      <section className="section-y">
        <Container width="wide">
          <div className="flex items-baseline justify-between border-b border-ink pb-3">
            <h2 className="font-display text-2xl font-semibold text-ink">Where we slept this season</h2>
            <a href={HREF} className="text-sm font-medium text-brand-700 underline underline-offset-4">All stays</a>
          </div>
          <ol className="grid gap-x-10 md:grid-cols-2">
            {SAMPLE_ITEMS.slice(0, 6).map((s, i) => (
              <li key={s.id} className="border-b border-line">
                <a href={HREF} className="group grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-3 py-5">
                  <span className="font-display text-2xl text-brand-700 tabular-nums">{i + 1}</span>
                  <span>
                    <span className="block font-display text-xl font-medium text-ink group-hover:underline">{s.title}</span>
                    <span className="mt-1 block text-sm text-muted">{s.place} · {s.category}</span>
                  </span>
                  <span className="text-sm text-ink tabular-nums">{usd0(s.price)}</span>
                </a>
              </li>
            ))}
          </ol>
        </Container>
      </section>
      <FeatureGrid
        variant="steps"
        tone="raised"
        eyebrow="How it works"
        title="Three rules for every stay"
        features={[
          { title: 'We stay first', body: 'Nothing is listed until one of us has spent a night there.' },
          { title: 'Hosts, not chains', body: 'Every place is run by the person who answers your message.' },
          { title: 'One honest page', body: 'What is good, what is not, and who it suits.' },
        ]}
      />
      <CtaBand tone="ink" title="Get the next issue" subtitle="One letter a season. No other mail." actions={[{ label: 'Subscribe', href: HREF }]} />
    </>
  );
}

function BrowsePage() {
  const b = useSampleBrowse();
  return (
    <>
      <Header />
      <Browse
        title="All stays"
        subtitle="Every place we have written about, newest first."
        query={b.query} onQuery={b.onQuery}
        filters={[{ id: 'category', label: 'Kind', options: SAMPLE_CATEGORIES.map((c) => ({ value: c, label: c })), value: b.category, onChange: b.onCategory }]}
        sort={b.sort} sortOptions={SORTS} onSort={b.onSort}
        view="list" columns={2}
        items={b.items} itemKey={(s) => s.id}
        renderCard={(s) => <EntityCard href={HREF} image={s.image} title={s.title} subtitle={s.summary} />}
        renderRow={(s) => <EntityRow href={HREF} image={s.image} title={s.title} subtitle={s.summary} meta={[{ label: 'Place', value: s.place }]} trailing={<span className="font-display text-lg text-ink">{usd0(s.price)}</span>} />}
        total={b.total} page={b.page} pageSize={b.pageSize} onPage={b.onPage}
      />
    </>
  );
}

function DetailPage() {
  const s = SAMPLE_ITEMS[3];
  return (
    <>
      <Header />
      <Detail
        variant="stacked"
        crumbs={[{ label: 'Stays', href: HREF }, { label: s.category, href: HREF }, { label: s.title }]}
        eyebrow={s.place}
        title={s.title}
        subtitle={s.summary}
        image={art(14, 1600, 700)}
        facts={[{ label: 'From', value: `${usd0(s.price)} a night` }, { label: 'Minimum', value: `${s.nights} nights` }, { label: 'Rating', value: `${s.rating} / 5` }]}
        body={
          <>
            <p>We arrived after dark, which is the right way to meet this place: the courtyard fire was already going and the sky above it was doing something we had not seen since childhood.</p>
            <h2>The rooms</h2>
            <p>Two bedrooms off a long kitchen, thick walls that hold the day's heat into the night, and a bath big enough to read in.</p>
            <h2>Who it suits</h2>
            <ul><li>Two couples, or a family with older kids</li><li>Anyone who wants to be outside after 10 pm</li></ul>
          </>
        }
        actions={
          <div className="space-y-3">
            <p className="font-display text-2xl text-ink">{usd0(s.price)} <span className="text-sm font-normal text-muted">a night</span></p>
            <a href={HREF} className="block rounded-control bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-brand-ink">Check dates</a>
            <p className="text-xs text-muted">Hosted by {s.host}. Booked direct.</p>
          </div>
        }
        related={{ title: 'More in the desert', content: <div className="grid gap-6 sm:grid-cols-3">{SAMPLE_ITEMS.slice(5, 8).map((r) => <EntityCard key={r.id} href={HREF} image={r.image} title={r.title} subtitle={r.place} badge={<Tag>{r.category}</Tag>} />)}</div> }}
      />
    </>
  );
}

export const broadsheet: Direction = {
  id: 'broadsheet',
  name: 'Broadsheet',
  idea: 'Editorial: serif headlines, ruled lines, a numbered index instead of cards, a reading column. Content first.',
  fonts: ['Newsreader:opsz,wght@6..72,400..700', 'Instrument Sans:wght@400..700'],
  tokens: {
    surface: 'oklch(98.7% 0.004 85)', panel: 'oklch(99.7% 0.002 85)', raised: 'oklch(95.5% 0.006 85)',
    ink: 'oklch(19% 0.01 70)', muted: 'oklch(42% 0.012 70)', faint: 'oklch(51% 0.01 70)',
    line: 'oklch(88.5% 0.008 80)', 'line-strong': 'oklch(78% 0.01 80)',
    ...ramp('oklch(42% 0.085 160)'), 'brand-ink': 'oklch(99% 0.003 160)',
    'typeface-display': '"Newsreader", Georgia, serif', 'typeface-body': '"Instrument Sans", system-ui, sans-serif',
    'corner-card': '0.1875rem', 'corner-control': '0.1875rem', density: '1.15',
  },
  dark: {
    surface: 'oklch(17% 0.006 70)', panel: 'oklch(20.5% 0.007 70)', raised: 'oklch(25% 0.008 70)',
    ink: 'oklch(93.5% 0.008 85)', muted: 'oklch(75% 0.01 85)', faint: 'oklch(64% 0.01 85)',
    line: 'oklch(31% 0.01 70)', 'line-strong': 'oklch(40% 0.012 70)',
    'brand-50': 'oklch(28% 0.035 160)', 'brand-600': 'oklch(78% 0.085 160)', 'brand-700': 'oklch(84% 0.07 160)', 'brand-ink': 'oklch(17% 0.02 160)',
  },
  pages: { home: Home, browse: BrowsePage, detail: DetailPage },
};
