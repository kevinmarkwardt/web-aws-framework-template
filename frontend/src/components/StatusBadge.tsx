import { useTranslation } from '@yourapp/shared';

const statusStyles: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-800',
  LIVE: 'bg-green-100 text-green-800',
  MISSING: 'bg-red-100 text-red-800',
  '404': 'bg-orange-100 text-orange-800',
  REDIRECT: 'bg-yellow-100 text-yellow-800',
  ERROR: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-blue-100 text-blue-800',
};

const defaultStyle = 'bg-gray-100 text-gray-800';

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
