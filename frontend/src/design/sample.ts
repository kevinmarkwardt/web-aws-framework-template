/** Demo content for the template's example directions only. A real site's directions use its MSW fixtures
 *  (packages/shared/src/mocks/fixtures/), so the user judges the design on their own data. Images are generated SVGs:
 *  no network, deterministic. */

export interface SampleItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  place: string;
  price: number;
  rating: number;
  nights: number;
  host: string;
  image: string;
}

/** A soft gradient landscape as a data URI: one hue per item, so cards are told apart at a glance. */
export function art(seed: number, w = 800, h = 600): string {
  const hue = (seed * 47) % 360;
  const a = `hsl(${hue} 45% 62%)`;
  const b = `hsl(${(hue + 40) % 360} 50% 38%)`;
  const c = `hsl(${(hue + 200) % 360} 35% 88%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${w * (0.2 + ((seed * 13) % 60) / 100)}" cy="${h * 0.3}" r="${h * 0.09}" fill="${c}" opacity="0.9"/>` +
    `<path d="M0 ${h * 0.72} Q ${w * 0.25} ${h * 0.5} ${w * 0.5} ${h * 0.68} T ${w} ${h * 0.6} V ${h} H 0 Z" fill="${b}" opacity="0.85"/>` +
    `<path d="M0 ${h * 0.85} Q ${w * 0.35} ${h * 0.7} ${w * 0.7} ${h * 0.84} T ${w} ${h * 0.8} V ${h} H 0 Z" fill="${b}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const rows: [string, string, string, string, number, number, number, string][] = [
  ['Juniper Ridge Cabin', 'A cedar cabin above the tree line with a wood stove and a view down the whole valley.', 'Cabins', 'Bend, Oregon', 184, 4.9, 2, 'Maren'],
  ['The Salt House', 'Whitewashed rooms two minutes from the dunes. Bikes and beach towels included.', 'Coast', 'Cape Cod, Massachusetts', 236, 4.8, 3, 'Tobias'],
  ['Orchard Loft', 'An old apple barn turned into a bright loft, breakfast from the farm stand downstairs.', 'Farm stays', 'Hudson Valley, New York', 158, 4.7, 2, 'Ines'],
  ['Mesa Light', 'Adobe walls, a courtyard with a fire pit, and the darkest skies in the state.', 'Desert', 'Taos, New Mexico', 212, 4.95, 3, 'Ruben'],
  ['Larch & Fern', 'A small A-frame on a creek, reached by a footbridge. No wifi, good books.', 'Cabins', 'North Cascades, Washington', 139, 4.85, 2, 'Saoirse'],
  ['Harbor Room No. 4', 'A captain\'s room over the fish market with windows on three sides of the harbor.', 'Coast', 'Portland, Maine', 198, 4.6, 2, 'Eli'],
  ['Prairie Schoolhouse', 'A one-room schoolhouse from 1902, restored with a deep tub where the chalkboard was.', 'Farm stays', 'Flint Hills, Kansas', 121, 4.8, 2, 'Dana'],
  ['Canyon Wren Casita', 'A guest house tucked into red rock, ten minutes from three trailheads.', 'Desert', 'Sedona, Arizona', 265, 4.9, 4, 'Priya'],
  ['The Lookout Tower', 'A converted fire lookout with 360 degree windows. Fourteen steep stairs and worth every one.', 'Cabins', 'Bitterroot, Montana', 175, 4.97, 2, 'Walt'],
];

export const SAMPLE_ITEMS: SampleItem[] = rows.map(([title, summary, category, place, price, rating, nights, host], i) => ({
  id: `s${i + 1}`, title, summary, category, place, price, rating, nights, host, image: art(i + 3),
}));

export const SAMPLE_CATEGORIES = [...new Set(SAMPLE_ITEMS.map((s) => s.category))];

export const usd0 = (n: number) => `$${n.toLocaleString('en-US')}`;
