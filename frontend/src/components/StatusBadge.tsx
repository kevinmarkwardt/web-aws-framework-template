import type { LinkStatus } from '../types';

const statusStyles: Record<LinkStatus, string> = {
  LIVE: 'bg-green-100 text-green-800',
  MISSING: 'bg-red-100 text-red-800',
  '404': 'bg-orange-100 text-orange-800',
  REDIRECT: 'bg-yellow-100 text-yellow-800',
  ERROR: 'bg-gray-100 text-gray-800',
  PENDING: 'bg-blue-100 text-blue-800',
};

export default function StatusBadge({ status }: { status: LinkStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}
