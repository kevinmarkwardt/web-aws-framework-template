import { Button, Input, shiftDay, useTranslation, utcToday } from '@yourapp/shared';

/** Pick a UTC day (payments and logs are filed by UTC day): previous, a date field, next, today. */
export default function DayNav({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  const { t } = useTranslation();
  const today = utcToday();
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" onClick={() => onChange(shiftDay(day, -1))} aria-label={t('admin.dayNav.previousDay')}>‹</Button>
      <Input type="date" value={day} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-40 py-1" />
      <Button size="sm" onClick={() => onChange(shiftDay(day, 1))} disabled={day >= today} aria-label={t('admin.dayNav.nextDay')}>›</Button>
      {day !== today && <Button size="sm" variant="ghost" onClick={() => onChange(today)}>{t('admin.dayNav.today')}</Button>}
      <span className="ml-1 text-xs text-faint">{t('admin.dayNav.utc')}</span>
    </div>
  );
}
