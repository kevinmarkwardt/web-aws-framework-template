/* The landing page's live demos: small working pieces of the product instead of screenshots or illustrations. They
   animate only while on screen, and reduced-motion visitors see a still, finished state. The data is the demo's own
   (landing.json `demo`), never claims about real usage. A site built from the template replaces these with its own. */
import { useState } from 'react';
import { useInView, useLoop } from '@yourapp/shared/archetypes';
import { useTranslation } from '@yourapp/shared';

interface Row { name: string; url: string }

const panel = 'rounded-card border border-line bg-panel';
const mono = 'font-mono text-xs';

function useRows(): Row[] {
  const { t } = useTranslation();
  const rows = t('landing.demo.rows', { returnObjects: true });
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/** Hero: a monitor where, every few seconds, one item changes, flashes and sends an alert. */
export function LiveMonitor() {
  const { t } = useTranslation();
  const rows = useRows();
  const [step, setStep] = useState(0);
  const { ref, reduced } = useLoop<HTMLDivElement>(() => setStep((s) => s + 1), 1000);
  // every 5 seconds the next item changes and stays "changed" for 3 of them
  const cycle = Math.floor(step / 5);
  const changed = reduced ? 0 : (step % 5 < 3 ? cycle % Math.max(rows.length, 1) : -1);
  const ages = rows.map((_, i) => ((step + i * 7) % 50) + 3);

  return (
    <div ref={ref} className={`${panel} relative overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span aria-hidden className="relative flex h-2 w-2">
            {!reduced && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          {t('landing.demo.title')}
        </span>
        <span className={`${mono} text-muted`}>{t('landing.demo.count', { count: rows.length })}</span>
      </div>
      <ul>
        {rows.map((r, i) => {
          const isChanged = i === changed;
          return (
            <li key={r.url} className={`flex items-center gap-3 border-b border-line px-4 py-3 transition-colors duration-500 last:border-0 ${isChanged ? 'bg-warn-soft' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                <p className={`${mono} truncate text-muted`}>{r.url}</p>
              </div>
              <span className={`${mono} hidden text-faint sm:inline tabular-nums`}>{t('landing.demo.checked', { s: ages[i] })}</span>
              <span className={`w-24 rounded-full px-2 py-0.5 text-center text-xs font-medium transition-colors duration-500 ${isChanged ? 'bg-warn text-panel' : 'bg-raised text-muted'}`}>
                {isChanged ? t('landing.demo.changed') : t('landing.demo.ok')}
              </span>
            </li>
          );
        })}
      </ul>
      {/* the alert that goes out */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-end">
        <div className={`flex items-center gap-2 rounded-control border border-line-strong bg-ink px-3 py-2 text-xs font-medium text-surface shadow-lg transition-all duration-500 ${changed >= 0 && !reduced ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
          <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0-9.75 6.75L2.25 6.75" /></svg>
          {changed >= 0 && rows[changed] ? t('landing.demo.alert', { name: rows[changed].name }) : ' '}
        </div>
      </div>
    </div>
  );
}

/** "Add anything with a URL": the URL types itself, Add is pressed, the item joins the list. */
export function AddDemo() {
  const { t } = useTranslation();
  const url = t('landing.demo.addUrl');
  const [tick, setTick] = useState(0);
  const { ref, reduced } = useLoop<HTMLDivElement>(() => setTick((n) => (n + 1) % (url.length + 40)), 70);
  const typed = reduced ? url.length : Math.min(tick, url.length);
  const pressed = !reduced && tick >= url.length + 4 && tick < url.length + 8;
  const added = reduced || tick >= url.length + 8;
  return (
    <div ref={ref} className={`${panel} p-4`}>
      <label className="block text-xs font-medium text-muted">{t('landing.demo.addLabel')}</label>
      <div className="mt-1.5 flex gap-2">
        <div className={`${mono} flex h-9 min-w-0 flex-1 items-center rounded-control border border-line-strong bg-surface px-3 text-sm text-ink`}>
          <span className="truncate">{url.slice(0, typed)}</span>
          {!reduced && typed < url.length && <span aria-hidden className="ml-px inline-block h-4 w-px animate-pulse bg-ink" />}
        </div>
        <span className={`inline-flex h-9 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-brand-ink transition-transform duration-150 ${pressed ? 'scale-95' : ''}`}>
          {t('landing.demo.add')}
        </span>
      </div>
      <p className={`mt-3 flex items-center gap-2 text-xs text-ok transition-opacity duration-300 ${added ? 'opacity-100' : 'opacity-0'}`}>
        <svg aria-hidden className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
        {t('landing.demo.added')}
      </p>
    </div>
  );
}

/** "Checked on your schedule": 24 hourly checks fill in; one of them found a change. */
export function ScheduleDemo() {
  const { t } = useTranslation();
  const [n, setN] = useState(0);
  const { ref, reduced } = useLoop<HTMLDivElement>(() => setN((v) => (v >= 34 ? 0 : v + 1)), 110);
  const shown = reduced ? 24 : Math.min(n, 24);
  const CHANGE = 15;
  return (
    <div ref={ref} className={`${panel} p-4`}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">{t('landing.demo.hours')}</span>
        <span className={`${mono} text-muted tabular-nums`}>{t('landing.demo.checks', { count: shown })}</span>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1" aria-hidden>
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={`h-8 rounded-[2px] transition-colors duration-200 ${i >= shown ? 'bg-raised' : i === CHANGE ? 'bg-warn' : 'bg-brand-600/70'}`} />
        ))}
      </div>
      <p className={`${mono} mt-3 text-muted transition-opacity duration-300 ${shown > CHANGE ? 'opacity-100' : 'opacity-0'}`}>
        {t('landing.demo.change', { time: `${String(CHANGE).padStart(2, '0')}:00` })}
      </p>
    </div>
  );
}

/** "Alerts that show the change": the alert's diff, before and after. */
export function DiffDemo() {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0.4 });
  const line = 'px-3 py-1.5 transition-all duration-700';
  return (
    <div ref={ref} className={`${panel} overflow-hidden`}>
      <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-medium text-ink">{t('landing.demo.diffTitle')}</span>
        <span className={`${mono} text-faint`}>{t('landing.demo.diffWhen')}</span>
      </div>
      <div className={`${mono} p-2 text-[13px] leading-relaxed`}>
        <div className={`${line} text-muted`}>&nbsp; {t('landing.demo.diffContext')}</div>
        <div className={`${line} rounded-[2px] bg-danger-soft text-danger ${inView ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDelay: '150ms' }}>
          − {t('landing.demo.diffOld')}
        </div>
        <div className={`${line} rounded-[2px] bg-ok-soft text-ok ${inView ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDelay: '450ms' }}>
          + {t('landing.demo.diffNew')}
        </div>
      </div>
    </div>
  );
}

/** "A weekly digest": the three counts, with bars that grow in. */
export function DigestDemo() {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>({ amount: 0.4 });
  const rows = [
    { label: t('landing.demo.digestHealthy'), n: 42, tone: 'bg-brand-600/70' },
    { label: t('landing.demo.digestChanged'), n: 3, tone: 'bg-warn' },
    { label: t('landing.demo.digestFailing'), n: 1, tone: 'bg-danger' },
  ];
  return (
    <div ref={ref} className={`${panel} p-4`}>
      <span className="text-xs font-medium text-muted">{t('landing.demo.digestTitle')}</span>
      <dl className="mt-3 space-y-2.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
            <dt className="text-ink">{r.label}</dt>
            <dd className="h-2 overflow-hidden rounded-full bg-raised">
              <span className={`block h-full rounded-full ${r.tone} transition-[width] duration-1000 ease-out`}
                style={{ width: inView ? `${Math.max(4, (r.n / 42) * 100)}%` : '0%', transitionDelay: `${i * 150}ms` }} />
            </dd>
            <dd className={`${mono} text-right text-ink tabular-nums`}>{r.n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
