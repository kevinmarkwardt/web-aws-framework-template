import { Button, Input, shiftDay, utcToday } from '@yourapp/shared';

/** Pick a UTC day (payments and logs are filed by UTC day): previous, a date field, next, today. */
export default function DayNav({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  const today = utcToday();
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" onClick={() => onChange(shiftDay(day, -1))} aria-label="Previous day">‹</Button>
      <Input type="date" value={day} max={today} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-40 py-1" />
      <Button size="sm" onClick={() => onChange(shiftDay(day, 1))} disabled={day >= today} aria-label="Next day">›</Button>
      {day !== today && <Button size="sm" variant="ghost" onClick={() => onChange(today)}>Today</Button>}
      <span className="ml-1 text-xs text-faint">UTC</span>
    </div>
  );
}
