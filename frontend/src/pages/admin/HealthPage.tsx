import { useState, useEffect } from 'react';
import { fetchHealth } from '../../admin-api';
import type { HealthData } from '../../admin-types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetchHealth()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
        <button onClick={load} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Refresh</button>
      </div>

      {/* Lambda Functions */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Lambda Functions (24h)</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(data.lambda).map(([name, stats]) => (
          <div key={name} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-900 mb-2">{name.replace('yourapp-', '')}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.invocations}</p>
                <p className="text-xs text-gray-500">Invocations</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${stats.errors > 0 ? 'text-red-600' : 'text-gray-900'}`}>{stats.errors}</p>
                <p className="text-xs text-gray-500">Errors</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats.avgDurationMs}</p>
                <p className="text-xs text-gray-500">Avg ms</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DynamoDB */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">DynamoDB</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-medium">{data.dynamodb.itemCount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Table Size</span><span className="font-medium">{formatBytes(data.dynamodb.tableSizeBytes)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Provisioned RCU</span><span className="font-medium">{data.dynamodb.provisionedRCU}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Provisioned WCU</span><span className="font-medium">{data.dynamodb.provisionedWCU}</span></div>
          </div>
        </div>

        {/* SES */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">SES Email</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Delivery Attempts</span><span className="font-medium">{data.ses.deliveryAttempts}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Bounces</span><span className={`font-medium ${data.ses.bounces > 0 ? 'text-red-600' : ''}`}>{data.ses.bounces}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Complaints</span><span className={`font-medium ${data.ses.complaints > 0 ? 'text-red-600' : ''}`}>{data.ses.complaints}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Rejects</span><span className="font-medium">{data.ses.rejects}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
