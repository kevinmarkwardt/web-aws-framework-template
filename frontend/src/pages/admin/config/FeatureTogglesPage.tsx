import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

const TOGGLES = [
  ['maintenanceMode', 'Maintenance Mode', 'Shows a "back soon" page to all visitors'],
  ['signupsEnabled', 'Signups Enabled', 'Allow new user registrations'],
  ['crawlingEnabled', 'Processing Enabled', 'Run scheduled item processing jobs'],
  ['alertsEnabled', 'Alerts Enabled', 'Send status change alert emails'],
] as const;

export default function FeatureTogglesPage() {
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

  const toggle = (key: keyof SiteConfig) => {
    if (!config) return;
    setConfig({ ...config, [key]: !config[key] });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateConfig({
        maintenanceMode: config.maintenanceMode,
        signupsEnabled: config.signupsEnabled,
        crawlingEnabled: config.crawlingEnabled,
        alertsEnabled: config.alertsEnabled,
      });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Feature Toggles</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Toggles</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div className="space-y-3">
          {TOGGLES.map(([key, label, desc]) => (
            <label key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              <button
                onClick={() => toggle(key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config[key] ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config[key] ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
