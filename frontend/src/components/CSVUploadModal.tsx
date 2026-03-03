import { useState, useRef } from 'react';
import { uploadCSV } from '../api';
import type { Link } from '../types';

interface CSVUploadModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: (links: Link[]) => void;
}

interface ParsedRow {
  pageUrl: string;
  destinationUrl: string;
  anchorText: string;
}

export default function CSVUploadModal({ open, onClose, onAdded }: CSVUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter((l) => l.trim());
      const rows: ParsedRow[] = [];

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
        // Skip header row
        if (i === 0 && parts[0]?.toLowerCase().includes('url')) continue;
        if (parts[0] && parts[1]) {
          rows.push({
            pageUrl: parts[0],
            destinationUrl: parts[1],
            anchorText: parts[2] || '',
          });
        }
      }
      setPreview(rows.slice(0, 10));
    };
    reader.readAsText(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Select a CSV file');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const links = await uploadCSV(file);
      onAdded(links);
      setFile(null);
      setPreview([]);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Upload CSV</h3>
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
            Expected columns: <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">page_url, destination_url, anchor_text</code>
          </p>
          <div
            onClick={() => inputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
            {file ? (
              <p className="text-sm text-gray-900 font-medium">{file.name}</p>
            ) : (
              <>
                <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-gray-500">Click to select a CSV file</p>
              </>
            )}
          </div>

          {preview.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <p className="text-xs text-gray-500 mb-2">Preview (first {preview.length} rows):</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1 pr-3 text-gray-500 font-medium">Page URL</th>
                    <th className="text-left py-1 pr-3 text-gray-500 font-medium">Destination URL</th>
                    <th className="text-left py-1 text-gray-500 font-medium">Anchor Text</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1 pr-3 text-gray-700 truncate max-w-48">{row.pageUrl}</td>
                      <td className="py-1 pr-3 text-gray-700 truncate max-w-48">{row.destinationUrl}</td>
                      <td className="py-1 text-gray-700">{row.anchorText || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
              disabled={loading || !file}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Uploading...' : 'Upload & Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
