import type { Link } from '../types';
import StatusBadge from './StatusBadge';

export default function LinkDetailDrawer({ link }: { link: Link }) {
  const history = link.statusHistory || [];
  const recent = history.slice(-10).reverse();

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div className="py-4 border-t border-gray-100">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Page URL</p>
          <a
            href={link.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:text-indigo-700 break-all"
          >
            {link.pageUrl}
          </a>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Destination URL</p>
          <a
            href={link.destinationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 hover:text-indigo-700 break-all"
          >
            {link.destinationUrl}
          </a>
        </div>
        {link.anchorText && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Anchor Text</p>
            <p className="text-sm text-gray-900">{link.anchorText}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500 mb-1">First Added</p>
          <p className="text-sm text-gray-900">{formatDate(link.firstAdded)}</p>
        </div>
      </div>

      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">
        Status History (last {recent.length} checks)
      </h4>
      {recent.length === 0 ? (
        <p className="text-sm text-gray-500">No checks recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {recent.map((entry, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
              <span className="text-xs text-gray-500 w-40 shrink-0">
                {formatDate(entry.date)}
              </span>
              <StatusBadge status={entry.status} />
              {entry.httpCode && (
                <span className="text-xs text-gray-400">HTTP {entry.httpCode}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
