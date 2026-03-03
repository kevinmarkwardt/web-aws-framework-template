import { useState, useEffect } from 'react';
import { fetchAllPitches, deleteAdminPitch } from '../../../admin-api';
import type { Pitch } from '../../../types';

export default function PitchesPage() {
  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPitches = () => {
    setLoading(true);
    fetchAllPitches()
      .then(setPitches)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPitches(); }, []);

  const handleDeletePitch = async (userId: string, pitchId: string) => {
    if (!confirm('Delete this pitch?')) return;
    await deleteAdminPitch(userId, pitchId);
    loadPitches();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Pitches</h1>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Domain</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Contact</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Pitched</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : pitches.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No pitches found</td></tr>
            ) : pitches.map((p) => (
              <tr key={`${p.userId}-${p.pitchId}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{p.domain}</td>
                <td className="px-4 py-3 text-xs">{p.status}</td>
                <td className="px-4 py-3 text-gray-600">{p.contactName}</td>
                <td className="px-4 py-3 text-gray-500">{p.pitchSentDate ? new Date(p.pitchSentDate).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{p.userId?.slice(0, 8)}...</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDeletePitch(p.userId!, p.pitchId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
