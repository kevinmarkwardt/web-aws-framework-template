import { useState } from 'react';
import { addLink } from '../api';
import type { Link } from '../types';

interface AddLinkFormProps {
  onAdded: (link: Link) => void;
  onOpenBulk: () => void;
  onOpenCSV: () => void;
}

export default function AddLinkForm({ onAdded, onOpenBulk, onOpenCSV }: AddLinkFormProps) {
  const [pageUrl, setPageUrl] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [anchorText, setAnchorText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const link = await addLink({ pageUrl, destinationUrl, anchorText: anchorText || undefined });
      onAdded(link);
      setPageUrl('');
      setDestinationUrl('');
      setAnchorText('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Add a link to monitor</h3>
        <div className="flex gap-2">
          <button
            onClick={onOpenBulk}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Bulk Paste
          </button>
          <button
            onClick={onOpenCSV}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Upload CSV
          </button>
        </div>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <input
          type="url"
          required
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          placeholder="Page URL (where the link lives)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
        />
        <input
          type="url"
          required
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          placeholder="Destination URL (your site)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={anchorText}
          onChange={(e) => setAnchorText(e.target.value)}
          placeholder="Anchor text (optional)"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? 'Adding...' : 'Add Link'}
        </button>
      </form>
    </div>
  );
}
