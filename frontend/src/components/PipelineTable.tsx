import { useState } from 'react';
import type { Pitch, PipelineStatus } from '../types';
import { updatePitch, deletePitch } from '../api';

interface PipelineTableProps {
  pitches: Pitch[];
  onUpdate: (pitch: Pitch) => void;
  onDelete: (pitchId: string) => void;
}

const statusOptions: PipelineStatus[] = [
  'PITCHED',
  'FOLLOW_UP_DUE',
  'ACCEPTED',
  'DRAFT_SUBMITTED',
  'PUBLISHED',
  'REJECTED',
  'UNRESPONSIVE',
];

const statusColors: Record<PipelineStatus, string> = {
  PITCHED: 'bg-blue-100 text-blue-800',
  FOLLOW_UP_DUE: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  DRAFT_SUBMITTED: 'bg-purple-100 text-purple-800',
  PUBLISHED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  UNRESPONSIVE: 'bg-gray-100 text-gray-800',
};

type SortField = 'domain' | 'status' | 'pitchSentDate';

export default function PipelineTable({ pitches, onUpdate, onDelete }: PipelineTableProps) {
  const [sortField, setSortField] = useState<SortField>('pitchSentDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = [...pitches].sort((a, b) => {
    const av = a[sortField] || '';
    const bv = b[sortField] || '';
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const handleStatusChange = async (pitch: Pitch, newStatus: PipelineStatus) => {
    const data: Partial<Pitch> = { status: newStatus };

    if (newStatus === 'PUBLISHED') {
      const url = prompt('Enter the published URL:');
      if (url) {
        data.publishedUrl = url;
        data.publishedDate = new Date().toISOString();
      }
    }

    try {
      const updated = await updatePitch(pitch.pitchId, data);
      onUpdate(updated);
    } catch {
      // Error handled upstream
    }
  };

  const handleDelete = async (pitchId: string) => {
    try {
      await deletePitch(pitchId);
      onDelete(pitchId);
    } catch {
      // Error handled upstream
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
        </svg>
        <p className="text-gray-500 text-sm">No pitches yet. Click "Add Pitch" to track your outreach.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th
                className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                onClick={() => toggleSort('domain')}
              >
                Domain
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden md:table-cell">
                Contact
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none"
                onClick={() => toggleSort('status')}
              >
                Status
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer select-none hidden sm:table-cell"
                onClick={() => toggleSort('pitchSentDate')}
              >
                Pitch Date
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden lg:table-cell">
                Published URL
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden xl:table-cell">
                Notes
              </th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((pitch) => (
              <tr key={pitch.pitchId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900 font-medium">{pitch.domain}</td>
                <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                  <div>{pitch.contactName}</div>
                  {pitch.contactEmail && (
                    <div className="text-xs text-gray-400">{pitch.contactEmail}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={pitch.status}
                    onChange={(e) =>
                      handleStatusChange(pitch, e.target.value as PipelineStatus)
                    }
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${statusColors[pitch.status]}`}
                  >
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                  {formatDate(pitch.pitchSentDate)}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {pitch.publishedUrl ? (
                    <a
                      href={pitch.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700 text-xs truncate block max-w-48"
                    >
                      {pitch.publishedUrl}
                    </a>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs hidden xl:table-cell max-w-48 truncate">
                  {pitch.notes || '-'}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(pitch.pitchId)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
