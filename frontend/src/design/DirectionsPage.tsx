/* /__directions: compare design directions (non-prod builds only; the route is compiled out of prod). Preview tooling,
   so its English labels are not translated. Every preview is an iframe of /__directions/view, so the directions'
   responsive layouts see a real phone or desktop width. */
import { useEffect, useRef, useState } from 'react';
import { Route, Routes, useSearchParams } from 'react-router-dom';
import DirectionFrame from './DirectionFrame';
import { SITE_DIRECTIONS } from './directions';
import { instrument } from './examples/instrument';
import { broadsheet } from './examples/broadsheet';
import { grid } from './examples/grid';
import { DIRECTION_PAGES } from './types';
import type { Direction, DirectionPage } from './types';

const DIRECTIONS: Direction[] = SITE_DIRECTIONS.length ? SITE_DIRECTIONS : [instrument, broadsheet, grid];
const DEVICES = { desktop: { width: 1280, height: 860 }, mobile: { width: 390, height: 844 } } as const;
type Device = keyof typeof DEVICES;

/** One direction's page, full screen: what the iframes load. */
function View() {
  const [params] = useSearchParams();
  const d = DIRECTIONS.find((x) => x.id === params.get('d')) ?? DIRECTIONS[0];
  const page = (DIRECTION_PAGES as readonly string[]).includes(params.get('p') ?? '') ? (params.get('p') as DirectionPage) : 'home';
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const Page = d.pages[page];
  useEffect(() => {
    document.title = `${d.name} · ${page}`;
  }, [d.name, page]);
  return <DirectionFrame direction={d} theme={theme}><Page /></DirectionFrame>;
}

/** An iframe rendered at the device's real width and scaled down to fit its column. */
function Preview({ direction, page, theme, device }: { direction: Direction; page: DirectionPage; theme: string; device: Device }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const { width, height } = DEVICES[device];
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const src = `/__directions/view?d=${direction.id}&p=${page}&theme=${theme}`;
  return (
    <div ref={box} className="w-full">
      <div className="mx-auto overflow-hidden rounded-card border border-line bg-panel shadow-sm" style={{ width: width * scale, height: height * scale }}>
        <iframe title={`${direction.name} ${page}`} src={src} style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }} />
      </div>
      <a href={src} target="_blank" rel="noreferrer" className="mt-2 block text-center text-xs text-muted hover:text-ink">Open full page ↗</a>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-control border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}
          className={`rounded-[calc(var(--corner-control)-2px)] px-3 py-1.5 text-xs font-medium capitalize ${value === o ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Gallery() {
  const [params, setParams] = useSearchParams();
  const page = (params.get('p') as DirectionPage) || 'home';
  const theme = (params.get('theme') as 'light' | 'dark') || 'light';
  const device = (params.get('device') as Device) || 'desktop';
  const focus = params.get('d');
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };
  const shown = focus ? DIRECTIONS.filter((d) => d.id === focus) : DIRECTIONS;

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="mr-auto font-semibold text-ink">
            Design directions{!SITE_DIRECTIONS.length && <span className="ml-2 text-xs font-normal text-muted">(template examples)</span>}
          </h1>
          <Segmented label="Page" value={page} options={DIRECTION_PAGES} onChange={(v) => set('p', v)} />
          <Segmented label="Device" value={device} options={['desktop', 'mobile'] as const} onChange={(v) => set('device', v)} />
          <Segmented label="Theme" value={theme} options={['light', 'dark'] as const} onChange={(v) => set('theme', v)} />
          <select value={focus ?? ''} onChange={(e) => set('d', e.target.value || null)} aria-label="Directions shown"
            className="rounded-control border border-line bg-panel px-2 py-1.5 text-xs text-ink">
            <option value="">All side by side</option>
            {DIRECTIONS.map((d) => <option key={d.id} value={d.id}>{d.name} only</option>)}
          </select>
        </div>
      </header>
      <main className={`mx-auto grid max-w-[110rem] gap-6 p-4 ${shown.length > 1 ? (device === 'mobile' ? 'md:grid-cols-3' : 'xl:grid-cols-3') : ''}`}>
        {shown.map((d, i) => (
          <section key={d.id} className="min-w-0">
            <div className="mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">Direction {String.fromCharCode(65 + i)}</p>
              <h2 className="text-lg font-semibold text-ink">{d.name}</h2>
              <p className="text-sm text-muted">{d.idea}</p>
            </div>
            <Preview direction={d} page={page} theme={theme} device={device} />
          </section>
        ))}
      </main>
    </div>
  );
}

export default function DirectionsPage() {
  return (
    <Routes>
      <Route path="view" element={<View />} />
      <Route path="*" element={<Gallery />} />
    </Routes>
  );
}
