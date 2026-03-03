import { useState, useEffect } from 'react';
import { fetchOverview } from '../../admin-api';
import type { AdminOverview } from '../../admin-types';

export default function OverviewPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOverview()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  const cards = [
    { label: 'Total Users', value: data.totalUsers, sub: `Free: ${data.planCounts.free} / Starter: ${data.planCounts.starter} / Pro: ${data.planCounts.pro}` },
    { label: 'Total Links', value: data.totalLinks, sub: Object.entries(data.statusCounts).map(([k, v]) => `${k}: ${v}`).join(' / ') },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Overview</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-sm font-medium text-gray-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{card.value}</p>
            <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
