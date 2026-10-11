/** Formatting both sites use. Money is always whole cents from the API; 100 credit units = $1. */

export const usd = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "1,250 credits" (the unit name is config creditName). */
export const units = (n: number, name = 'credits') => `${n.toLocaleString()} ${name}`;

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

export const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export const dateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Today as YYYY-MM-DD in UTC (the API files payments and logs by UTC day). */
export const utcToday = () => new Date().toISOString().slice(0, 10);

/** YYYY-MM-DD shifted by `days`. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};
