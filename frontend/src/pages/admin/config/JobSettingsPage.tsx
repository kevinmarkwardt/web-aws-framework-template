import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

export default function JobSettingsPage() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig({ jobSettings: config.jobSettings });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;
  if (error) return <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>;
  if (!config) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Job Settings</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Background Job Configuration</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Crawl Hour (UTC)</label>
            <input
              type="number"
              min="0"
              max="23"
              value={config.jobSettings.dailyCrawlHourUtc}
              onChange={(e) => setConfig({
                ...config,
                jobSettings: { ...config.jobSettings, dailyCrawlHourUtc: parseInt(e.target.value) || 0 },
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit Delay (ms)</label>
            <input
              type="number"
              value={config.jobSettings.rateLimitDelayMs}
              onChange={(e) => setConfig({
                ...config,
                jobSettings: { ...config.jobSettings, rateLimitDelayMs: parseInt(e.target.value) || 0 },
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.jobSettings.hourlyCrawlEnabled}
                onChange={(e) => setConfig({
                  ...config,
                  jobSettings: { ...config.jobSettings, hourlyCrawlEnabled: e.target.checked },
                })}
                className="rounded border-gray-300 text-indigo-600"
              />
              <span className="text-sm text-gray-700">Hourly Pro Crawls</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
