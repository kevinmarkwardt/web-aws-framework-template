/* Example direction "Immersive": the pictures sell it. Floating nav over a full-bleed cover, text on images, a
   horizontal rail on phones, big rounded shapes, dark by default. For galleries, venues, travel, fashion. */
import { Browse, CtaBand, Detail, EntityCard, Hero, Showcase, SiteHeader, Tag, Testimonials } from '@yourapp/shared/archetypes';
import { SAMPLE_CATEGORIES, SAMPLE_ITEMS, art, usd0 } from '../sample';
import { ramp } from '../types';
import type { Direction } from '../types';
import { HREF, SORTS, useSampleBrowse } from './shared';

const NAV = [{ label: 'Places', href: HREF }, { label: 'Stories', href: HREF }];

function Home() {
  return (
    <div className="relative">
      <div className="text-white [&_a]:text-white/90 [&_button]:text-white">
        <SiteHeader variant="floating" sticky={false} brand="drift" nav={NAV} right={<a href={HREF} className="rounded-full border border-white/40 px-4 py-1.5 text-sm">Sign in</a>} />
      </div>
      <Hero
        variant="cover"
        eyebrow="Nine places · one season"
        title="Go somewhere quiet."
        subtitle="Cabins, coast houses and desert casitas, photographed as they are."
        actions={[{ label: 'See the places', href: HREF }]}
        image={art(21, 1600, 900)}
      />
      <Showcase
        title="Right now"
        scroll
        items={SAMPLE_ITEMS.slice(0, 4)}
        renderItem={(s) => <EntityCard href={HREF} layout="overlay" image={s.image} imageRatio="3/4" title={s.title} subtitle={`${s.place} · ${usd0(s.price)}`} />}
      />
      <Testimonials
        title="From the guest book"
        items={[
          { quote: 'We did not open the laptop once.', name: 'Ana', role: 'Lookout Tower' },
          { quote: 'The stars alone were worth the drive.', name: 'Sam', role: 'Mesa Light' },
          { quote: 'Already booked again for spring.', name: 'Jules', role: 'Salt House' },
        ]}
      />
      <CtaBand title="New places every season" actions={[{ label: 'Get the list', href: HREF }]} />
    </div>
  );
}

function Header() {
  return <SiteHeader brand="drift" nav={NAV} right={<a href={HREF} className="rounded-full border border-line px-4 py-1.5 text-sm text-ink">Sign in</a>} />;
}

function BrowsePage() {
  const b = useSampleBrowse(9);
  return (
    <>
      <Header />
      <Browse
        title="Places"
        query={b.query} onQuery={b.onQuery}
        filters={[{ id: 'category', label: 'Mood', options: SAMPLE_CATEGORIES.map((c) => ({ value: c, label: c })), value: b.category, onChange: b.onCategory }]}
        sort={b.sort} sortOptions={SORTS} onSort={b.onSort}
        columns={3}
        items={b.items} itemKey={(s) => s.id}
        renderCard={(s) => <EntityCard href={HREF} layout="overlay" image={s.image} imageRatio="4/5" title={s.title} subtitle={`${s.place} · ${usd0(s.price)}`} badge={<Tag>{s.category}</Tag>} />}
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
        variant="split"
        title={s.title}
        subtitle={s.summary}
        image={s.image}
        gallery={[s.image, art(30), art(31), art(32)]}
        facts={[{ label: 'Where', value: s.place }, { label: 'From', value: `${usd0(s.price)} a night` }, { label: 'Rating', value: `${s.rating}` }]}
        actions={<a href={HREF} className="block rounded-full bg-brand-600 py-3 text-center font-semibold text-brand-ink">Book {s.title}</a>}
        related={{ title: 'Also quiet', content: <div className="grid gap-6 sm:grid-cols-3">{SAMPLE_ITEMS.slice(0, 3).map((r) => <EntityCard key={r.id} href={HREF} layout="overlay" image={r.image} title={r.title} subtitle={r.place} />)}</div> }}
      />
    </>
  );
}

export const immersive: Direction = {
  id: 'immersive',
  name: 'Immersive',
  idea: 'The pictures sell it: full-bleed cover, text on images, rails and big rounded shapes, dark first.',
  fonts: ['Space Grotesk:wght@400..700', 'DM Sans:opsz,wght@9..40,400..700'],
  tokens: {
    surface: '#0e0f11', panel: '#16181b', raised: '#1f2226', ink: '#f3f1ec', muted: '#b4b0a7', faint: '#8a867e', line: '#2a2d32',
    ...ramp('#e4b363'), 'brand-ink': '#17130b', 'brand-700': '#f0c983',
    'typeface-display': '"Space Grotesk", system-ui, sans-serif', 'typeface-body': '"DM Sans", system-ui, sans-serif',
    'corner-card': '1.25rem', 'corner-control': '999px', density: '1',
  },
  pages: { home: Home, browse: BrowsePage, detail: DetailPage },
};
