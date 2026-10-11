import { useTranslation } from '@yourapp/shared';

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-ok-soft text-ok',
  INACTIVE: 'bg-raised text-ink',
  LIVE: 'bg-ok-soft text-ok',
  MISSING: 'bg-danger-soft text-danger',
  '404': 'bg-orange-100 text-orange-800',
  REDIRECT: 'bg-warn-soft text-warn',
  ERROR: 'bg-raised text-ink',
  PENDING: 'bg-brand-50 text-brand-700',
};

const defaultStyle = 'bg-raised text-ink';

/** An item's status: its label from items.status.{STATUS} (the raw value when there is none). */
export default function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] ?? defaultStyle}`}
    >
      {t(`items.status.${status}`, { defaultValue: status })}
    </span>
  );
}
