import { useState } from 'react';
import { addLinksBulk } from '../api';
import type { Link } from '../types';

interface BulkPasteModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (links: Link[]) => void;
}

export default function BulkPasteModal({ open, onClose, onAdded }: BulkPasteModalProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setError('No links entered');
      return;
    }

    const parsed = lines.map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        pageUrl: parts[0] || '',
        destinationUrl: parts[1] || '',
        anchorText: parts[2] || undefined,
      };
    });

    const invalid = parsed.filter((p) => !p.pageUrl || !p.destinationUrl);
    if (invalid.length > 0) {
      setError(
        `${invalid.length} line(s) missing page URL or destination URL. Format: pageUrl, destinationUrl, anchorText`
      );
      return;
    }

    setLoading(true);
    try {
      const links = await addLinksBulk(parsed);
      onAdded(links);
      setText('');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add links');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Bulk Paste Links</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <p className="text-sm text-gray-600 mb-3">
            One link per line. Format: <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">pageUrl, destinationUrl, anchorText</code>
          </p>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://blog.com/post, https://mysite.com, My Site\nhttps://other.com/list, https://mysite.com/tool, Best Tool"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:ring-indigo-500 font-mono"
          />
          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Adding...' : 'Add Links'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
