/* The landing hero's animated graphic: a pile of soft shapes (the pages being watched) and a lens that glides over
   them, magnifying what's under it on a pixel grid and reading out what it's checking. Passing over the one page that
   changed turns the readout to "Changed". Positions update straight on the SVG each frame (no React re-render per
   frame); only the readout goes through state, and only when it changes. Reduced motion: the lens rests on the
   changed page. A site built from the template swaps the shapes and labels for its own subject. */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@yourapp/shared';
import { useInView, useReducedMotion } from '@yourapp/shared/archetypes';

const W = 640;
const H = 520;
const LENS = 168;          // lens size
const ZOOM = 2.4;          // magnification inside the lens
const CHANGED = 14;        // index of the page that changed

/** Muted tints that sit on light and dark grounds alike, plus the accent for one shape. */
const FILLS = [
  'oklch(87% 0.045 165)', 'oklch(84% 0.045 240)', 'oklch(89% 0.05 85)', 'oklch(78% 0.035 250)',
  'oklch(91% 0.02 250)', 'oklch(82% 0.06 35)', 'oklch(86% 0.04 300)', 'var(--brand-500)',
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

interface Shape { kind: 'rect' | 'pill' | 'circle' | 'tri'; x: number; y: number; w: number; h: number; r: number; fill: string }

/** A deterministic pile: one shape per cell of a loose grid, sized and turned a little at random. */
function buildShapes(): Shape[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: Shape[] = [];
  const cols = 6;
  const rows = 5;
  const cw = (W - 40) / cols;
  const ch = (H - 40) / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const kinds: Shape['kind'][] = ['rect', 'pill', 'circle', 'rect', 'tri', 'pill'];
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const w = cw * (0.78 + rnd() * 0.5);
      const h = kind === 'circle' ? w : kind === 'pill' ? w * (0.42 + rnd() * 0.2) : ch * (0.6 + rnd() * 0.45);
      out.push({
        kind,
        x: clamp(20 + i * cw + (cw - w) / 2 + (rnd() - 0.5) * 34, 6, W - w - 6),
        y: clamp(20 + j * ch + (ch - h) / 2 + (rnd() - 0.5) * 34, 6, H - h - 6),
        w, h,
        r: (rnd() - 0.5) * 34,
        fill: FILLS[Math.floor(rnd() * (FILLS.length - 1))],
      });
    }
  }
  out[CHANGED].fill = FILLS[FILLS.length - 1];
  return out;
}

function ShapeEl({ s }: { s: Shape }) {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const t = `rotate(${s.r} ${cx} ${cy})`;
  if (s.kind === 'circle') return <circle cx={cx} cy={cy} r={s.w / 2} fill={s.fill} />;
  if (s.kind === 'tri') return <path transform={t} fill={s.fill} d={`M${cx} ${s.y} L${s.x + s.w} ${s.y + s.h} L${s.x} ${s.y + s.h} Z`} strokeLinejoin="round" />;
  const rx = s.kind === 'pill' ? s.h / 2 : Math.min(s.w, s.h) * 0.22;
  return <rect transform={t} x={s.x} y={s.y} width={s.w} height={s.h} rx={rx} fill={s.fill} />;
}

/** Where the lens is at time t (seconds): a slow figure that sweeps the whole pile. */
const pathAt = (t: number) => ({
  x: W / 2 + (W / 2 - LENS / 2 - 24) * Math.sin(t * 0.33),
  y: H / 2 + (H / 2 - LENS / 2 - 24) * Math.sin(t * 0.47 + 1.1),
});

const centerOf = (s: Shape) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

const SHAPES = buildShapes();

export default function HeroGraphic() {
  const { t } = useTranslation();
  const shapes = SHAPES;
  const urls = t('landing.demo.rows', { returnObjects: true }) as { url: string }[];
  const [box, inView] = useInView<HTMLDivElement>({ amount: 0.1, repeat: true });
  const reduced = useReducedMotion();
  const lens = useRef<SVGGElement>(null);
  const zoom = useRef<SVGGElement>(null);
  const clip = useRef<SVGRectElement>(null);
  const [under, setUnder] = useState(CHANGED);

  useEffect(() => {
    const place = (p: { x: number; y: number }) => {
      const x0 = p.x - LENS / 2;
      const y0 = p.y - LENS / 2;
      lens.current?.setAttribute('transform', `translate(${x0} ${y0})`);
      clip.current?.setAttribute('x', String(x0));
      clip.current?.setAttribute('y', String(y0));
      // magnify around the lens center
      zoom.current?.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${ZOOM}) translate(${-p.x} ${-p.y})`);
      // the shape nearest the center is "being checked"
      let best = 0;
      let bestD = Infinity;
      shapes.forEach((s, i) => {
        const c = centerOf(s);
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      });
      setUnder((prev) => (prev === best ? prev : best));
    };
    if (reduced || !inView) {
      place(centerOf(shapes[CHANGED]));
      return;
    }
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      place(pathAt((now - start) / 1000 + 4));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, shapes]);

  const changed = under === CHANGED;
  const url = urls.length ? urls[(under === CHANGED ? 0 : (under % (urls.length - 1)) + 1)].url : '';
  const c = centerOf(shapes[CHANGED]);

  return (
    <div ref={box} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t('landing.graphic.label')}>
        <defs>
          <clipPath id="hero-lens-clip"><rect ref={clip} width={LENS} height={LENS} rx="30" /></clipPath>
          <pattern id="hero-pixels" width="7" height="7" patternUnits="userSpaceOnUse">
            <path d="M7 0H0V7" fill="none" stroke="var(--surface)" strokeOpacity="0.35" strokeWidth="1" />
          </pattern>
        </defs>

        {/* the pile */}
        <g>{shapes.map((s, i) => <ShapeEl key={i} s={s} />)}</g>
        {/* the changed page: a slow pulse around it */}
        <circle cx={c.x} cy={c.y} r={Math.max(shapes[CHANGED].w, shapes[CHANGED].h) * 0.62} fill="none" stroke="var(--warn)" strokeWidth="2.5"
          className={reduced ? '' : 'hero-pulse'} style={{ transformOrigin: `${c.x}px ${c.y}px` }} />

        {/* inside the lens: the same pile, magnified, on a pixel grid */}
        <g clipPath="url(#hero-lens-clip)">
          <rect x="-2000" y="-2000" width="5000" height="5000" fill="var(--surface)" />
          <g ref={zoom}>{shapes.map((s, i) => <ShapeEl key={i} s={s} />)}</g>
          <rect x="-2000" y="-2000" width="5000" height="5000" fill="url(#hero-pixels)" />
        </g>

        {/* the lens frame */}
        <g ref={lens} style={{ transition: reduced ? 'none' : undefined }}>
          <rect width={LENS} height={LENS} rx="30" fill="none" stroke="var(--ink)" strokeOpacity="0.85" strokeWidth="3" />
          <rect x="4" y="4" width={LENS - 8} height={LENS - 8} rx="26" fill="none" stroke="var(--panel)" strokeOpacity="0.7" strokeWidth="2" />
          <path d={`M${LENS / 2 - 7} ${LENS / 2}h14M${LENS / 2} ${LENS / 2 - 7}v14`} stroke="var(--ink)" strokeOpacity="0.7" strokeWidth="2" />
        </g>
      </svg>

      {/* the readout */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 -bottom-2 flex justify-center">
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs shadow-sm transition-colors duration-300 ${changed ? 'border-warn/40 bg-warn-soft text-warn' : 'border-line bg-panel text-muted'}`}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${changed ? 'bg-warn' : 'bg-ok'}`} />
          <span className="font-medium">{changed ? t('landing.graphic.changed') : t('landing.graphic.checking')}</span>
          <span className="text-faint">·</span>
          <span className="max-w-[16rem] truncate">{url}</span>
        </div>
      </div>
    </div>
  );
}
