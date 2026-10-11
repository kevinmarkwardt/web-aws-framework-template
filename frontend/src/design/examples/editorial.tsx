/* Example direction "Editorial": a magazine. Centered masthead, oversized serif headlines, numbered steps, a reading
   column on detail pages, generous spacing. For sites where the content is the product (recipes, guides, travel). */
import { Browse, CtaBand, Detail, EntityCard, EntityRow, FeatureGrid, Hero, Showcase, SiteHeader, Tag } from '@yourapp/shared/archetypes';
import { SAMPLE_CATEGORIES, SAMPLE_ITEMS, art, usd0 } from '../sample';
import { ramp } from '../types';
import type { Direction } from '../types';
import { HREF, SORTS, useSampleBrowse } from './shared';

const NAV = [{ label: 'Stays', href: HREF }, { label: 'Journal', href: HREF }, { label: 'About', href: HREF }];

function Header() {
  return <SiteHeader variant="centered" brand="Field Notes" nav={NAV} right={<a href={HREF} className="text-sm font-medium text-ink underline underline-offset-4">Sign in</a>} />;
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
      <Showcase
        eyebrow="This season"
        title="Where we slept"
        items={SAMPLE_ITEMS.slice(0, 3)}
        renderItem={(s) => <EntityCard href={HREF} image={s.image} imageRatio="3/4" title={s.title} subtitle={s.place} meta={[{ label: 'From', value: `${usd0(s.price)} a night` }]} />}
      />
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

export const editorial: Direction = {
  id: 'editorial',
  name: 'Editorial',
  idea: 'A magazine: big serif headlines, one story at a time, a reading column. Content first, commerce second.',
  fonts: ['Fraunces:opsz,wght@9..144,400..700', 'Source Sans 3:wght@400..700'],
  tokens: {
    surface: '#f7f3ec', panel: '#fffdf9', raised: '#efe8dc', ink: '#221c16', muted: '#6a5f53', faint: '#8d8172', line: '#e3dacb',
    ...ramp('#9c4523'), 'brand-ink': '#fffdf9',
    'typeface-display': '"Fraunces", Georgia, serif', 'typeface-body': '"Source Sans 3", system-ui, sans-serif',
    'corner-card': '0.25rem', 'corner-control': '0.25rem', density: '1.2',
  },
  dark: { surface: '#191512', panel: '#211c18', raised: '#2b2520', ink: '#f2ebe0', muted: '#bfb3a3', faint: '#8f8475', line: '#3a322b', 'brand-50': '#3a241a' },
  pages: { home: Home, browse: BrowsePage, detail: DetailPage },
};
