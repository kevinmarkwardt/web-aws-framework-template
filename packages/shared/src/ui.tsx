/** UI primitives both sites use, styled with the theme tokens (theme.css). Plain Tailwind, no component library. */
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---- buttons

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 border border-transparent',
  secondary: 'bg-panel text-ink border border-line hover:bg-raised',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
  ghost: 'text-muted hover:text-ink hover:bg-raised border border-transparent',
};

export function Button({ variant = 'secondary', size = 'md', className, busy, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner size="sm" />}
      {children}
    </button>
  );
}

// ---- form fields

const fieldCls =
  'block rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-faint ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-raised';

/** Full width unless the caller sets a width (w-...). */
const width = (className?: string) => (/(^|\s)w-/.test(className ?? '') ? '' : 'w-full');

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(fieldCls, width(className), className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(fieldCls, width(className), className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldCls, width(className), 'pr-8', className)}>
      {children}
    </select>
  );
}

/** A label above a field, with an optional hint below. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-sm font-medium text-ink mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint mt-1">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }:
  { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
        {hint && <p className="text-xs text-faint mt-0.5">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-line')}
      >
        <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform mt-0.5',
          checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

// ---- layout

export function Panel({ title, actions, children, className, padded = true }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    // min-w-0: a wide table inside scrolls in its own box instead of widening the page grid
    <section className={cx('min-w-0 rounded-card border border-line bg-panel', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'px-4 pb-4 pt-2' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-card border border-line bg-panel p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', tone ? TONE_TEXT[tone] : 'text-ink')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- status

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger';
const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-raised text-muted',
  brand: 'bg-brand-50 text-brand-700',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};
const TONE_TEXT: Record<Tone, string> = { neutral: 'text-ink', brand: 'text-brand-700', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' };
const TONE_NOTICE: Record<Tone, string> = {
  neutral: 'border-line bg-raised text-ink',
  brand: 'border-brand-200 bg-brand-50 text-brand-900',
  ok: 'border-ok/30 bg-ok-soft text-ok',
  warn: 'border-warn/30 bg-warn-soft text-warn',
  danger: 'border-danger/30 bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE_BADGE[tone])}>{children}</span>;
}

export function Notice({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <div role={tone === 'danger' ? 'alert' : undefined} className={cx('rounded-lg border px-3 py-2 text-sm', TONE_NOTICE[tone], className)}>{children}</div>;
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useTranslation();
  const s = { sm: 'h-3.5 w-3.5 border-2', md: 'h-5 w-5 border-2', lg: 'h-8 w-8 border-2' }[size];
  return <span aria-label={t('common.loading')} className={cx('inline-block animate-spin rounded-full border-current border-r-transparent text-brand-600', s)} />;
}

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted">
      <Spinner /> {label ?? t('common.loadingEllipsis')}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-faint">{children}</p>;
}

// ---- tables

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** right-aligned numbers */
  numeric?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, selected }:
  { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; empty?: ReactNode; selected?: string | null }) {
  const { t } = useTranslation();
  if (!rows.length) return <Empty>{empty ?? t('common.nothingYet')}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-faint">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-3 py-2 font-medium', c.numeric && 'text-right', c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const k = rowKey(row);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-raised', selected === k && 'bg-raised')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 py-2 align-top', c.numeric && 'text-right tabular-nums', c.className)}>{c.render(row)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- overlays

/** Escape closes the overlay. A dialog (`first`) listens in the capture phase and stops the key there, so Escape on a
 *  dialog opened over a drawer closes only the dialog. */
function useEscape(open: boolean, onClose: () => void, first = false) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (first) e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, first);
    return () => window.removeEventListener('keydown', onKey, first);
  }, [open, onClose, first]);
}

/** A centred modal. Escape or the backdrop closes it. */
export function Dialog({ open, title, onClose, children, footer }:
  { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(open, onClose, true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" className="relative w-full max-w-md rounded-card bg-panel shadow-xl">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** A panel that slides over the right side of the page. Escape or the backdrop closes it. */
export function Drawer({ open, title, onClose, children, actions }:
  { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEscape(open, onClose);
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full w-full max-w-3xl flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>✕</Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

/** Pretty-printed JSON (or a JSON string) in a scrollable block. */
export function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      text = value;
    }
  } else {
    text = JSON.stringify(value, null, 2);
  }
  return <pre className="max-h-72 overflow-auto rounded-lg bg-raised p-3 text-xs leading-relaxed text-ink">{text}</pre>;
}
