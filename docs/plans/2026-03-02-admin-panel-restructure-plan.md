# Admin Panel Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the admin panel sidebar from a flat 5-link layout into three grouped sections (Platform, App Data, App Config), splitting the monolithic Config and Data pages into focused sub-pages, and adding a new Billing page.

**Architecture:** Extract sections from ConfigPage.tsx and DataPage.tsx into standalone page components in `config/` and `data/` subdirectories. Each sub-page fetches and saves only its own config slice. New BillingPage combines Stripe config (from ConfigPage) with MRR metrics (from OverviewPage). AdminLayout gets grouped sidebar nav with section headers.

**Tech Stack:** React 19, TypeScript, React Router v7, Tailwind CSS v4, Vite

---

### Task 1: Create directory structure and extract LinksPage

**Files:**
- Create: `frontend/src/pages/admin/data/LinksPage.tsx`

**Step 1: Create the data directory**

```bash
mkdir -p frontend/src/pages/admin/data
```

**Step 2: Create LinksPage.tsx**

Extract the links tab content from `DataPage.tsx` (lines 1-8, 10-11, 13-28, 43-53, 61-71, 73, 75-143) into a standalone page. The page needs its own state for links, loading, error, search, statusFilter, and actionMsg. Include the "Crawl All" and "Send Digest" bulk action buttons.

```tsx
import { useState, useEffect } from 'react';
import {
  fetchAllLinks, deleteAdminLink, crawlAdminLink,
  triggerCrawlAll, triggerDigest,
} from '../../../admin-api';
import type { Link } from '../../../types';
import StatusBadge from '../../../components/StatusBadge';

export default function LinksPage() {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const loadLinks = () => {
    setLoading(true);
    fetchAllLinks({ status: statusFilter || undefined, q: search || undefined })
      .then(setLinks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadLinks(); }, [statusFilter]);

  const handleDeleteLink = async (userId: string, linkId: string) => {
    if (!confirm('Delete this link?')) return;
    await deleteAdminLink(userId, linkId);
    loadLinks();
  };

  const handleCrawl = async (userId: string, linkId: string) => {
    await crawlAdminLink(userId, linkId);
    setActionMsg('Crawl triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleCrawlAll = async () => {
    await triggerCrawlAll();
    setActionMsg('Crawl-all triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const handleDigest = async () => {
    await triggerDigest();
    setActionMsg('Digest triggered');
    setTimeout(() => setActionMsg(''), 3000);
  };

  const statuses = ['LIVE', 'MISSING', '404', 'REDIRECT', 'ERROR', 'PENDING'];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Links</h1>
        <div className="flex gap-2">
          <button onClick={handleCrawlAll} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">Crawl All</button>
          <button onClick={handleDigest} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Send Digest</button>
        </div>
      </div>

      {actionMsg && <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{actionMsg}</div>}
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search URLs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadLinks()}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm flex-1"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={loadLinks} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Page URL</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Destination</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading...</td></tr>
            ) : links.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No links found</td></tr>
            ) : links.map((l) => (
              <tr key={`${l.userId}-${l.linkId}`} className="hover:bg-gray-50">
                <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.pageUrl}</td>
                <td className="px-4 py-3 text-gray-600 truncate max-w-xs">{l.destinationUrl}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{l.userId?.slice(0, 8)}...</td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button onClick={() => handleCrawl(l.userId!, l.linkId)} className="text-indigo-600 hover:text-indigo-800 text-xs">Crawl</button>
                  <button onClick={() => handleDeleteLink(l.userId!, l.linkId)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 3: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors (page is not routed yet, just needs to compile)

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/data/LinksPage.tsx
git commit -m "feat(admin): extract LinksPage from DataPage"
```

---

### Task 2: Extract PitchesPage

**Files:**
- Create: `frontend/src/pages/admin/data/PitchesPage.tsx`

**Step 1: Create PitchesPage.tsx**

Extract the pitches tab content from `DataPage.tsx` into a standalone page.

```tsx
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
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/data/PitchesPage.tsx
git commit -m "feat(admin): extract PitchesPage from DataPage"
```

---

### Task 3: Extract FeatureTogglesPage

**Files:**
- Create: `frontend/src/pages/admin/config/FeatureTogglesPage.tsx`

**Step 1: Create the config directory**

```bash
mkdir -p frontend/src/pages/admin/config
```

**Step 2: Create FeatureTogglesPage.tsx**

This page fetches the full SiteConfig but only displays and saves the four boolean toggles. Uses `updateConfig()` with a partial payload containing just the toggle fields.

```tsx
import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

const TOGGLES = [
  ['maintenanceMode', 'Maintenance Mode', 'Shows a "back soon" page to all visitors'],
  ['signupsEnabled', 'Signups Enabled', 'Allow new user registrations'],
  ['crawlingEnabled', 'Crawling Enabled', 'Run scheduled link crawls'],
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
```

**Step 3: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add frontend/src/pages/admin/config/FeatureTogglesPage.tsx
git commit -m "feat(admin): extract FeatureTogglesPage from ConfigPage"
```

---

### Task 4: Extract PlanLimitsPage

**Files:**
- Create: `frontend/src/pages/admin/config/PlanLimitsPage.tsx`

**Step 1: Create PlanLimitsPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

export default function PlanLimitsPage() {
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
      await updateConfig({ planLimits: config.planLimits });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Plan Limits</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Max Links per Plan</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {(['free', 'starter', 'pro'] as const).map((plan) => (
            <div key={plan}>
              <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">{plan} — Max Links</label>
              <input
                type="number"
                value={config.planLimits[plan]}
                onChange={(e) => setConfig({
                  ...config,
                  planLimits: { ...config.planLimits, [plan]: parseInt(e.target.value) || 0 },
                })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/config/PlanLimitsPage.tsx
git commit -m "feat(admin): extract PlanLimitsPage from ConfigPage"
```

---

### Task 5: Extract CrawlSettingsPage

**Files:**
- Create: `frontend/src/pages/admin/config/CrawlSettingsPage.tsx`

**Step 1: Create CrawlSettingsPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

export default function CrawlSettingsPage() {
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
      await updateConfig({ crawlSettings: config.crawlSettings });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Crawl Settings</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Crawler Configuration</h2>
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
              value={config.crawlSettings.dailyCrawlHourUtc}
              onChange={(e) => setConfig({
                ...config,
                crawlSettings: { ...config.crawlSettings, dailyCrawlHourUtc: parseInt(e.target.value) || 0 },
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit Delay (ms)</label>
            <input
              type="number"
              value={config.crawlSettings.rateLimitDelayMs}
              onChange={(e) => setConfig({
                ...config,
                crawlSettings: { ...config.crawlSettings, rateLimitDelayMs: parseInt(e.target.value) || 0 },
              })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.crawlSettings.hourlyCrawlEnabled}
                onChange={(e) => setConfig({
                  ...config,
                  crawlSettings: { ...config.crawlSettings, hourlyCrawlEnabled: e.target.checked },
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
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/config/CrawlSettingsPage.tsx
git commit -m "feat(admin): extract CrawlSettingsPage from ConfigPage"
```

---

### Task 6: Extract EmailTemplatesPage

**Files:**
- Create: `frontend/src/pages/admin/config/EmailTemplatesPage.tsx`

**Step 1: Create EmailTemplatesPage.tsx**

```tsx
import { useState, useEffect } from 'react';
import { fetchConfig, updateConfig } from '../../../admin-api';
import type { SiteConfig } from '../../../admin-types';

export default function EmailTemplatesPage() {
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
      await updateConfig({ emailTemplates: config.emailTemplates });
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Email Templates</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Templates</h2>
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {Object.entries(config.emailTemplates).map(([key, value]) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{key}</label>
              <input
                type="text"
                value={value}
                onChange={(e) => setConfig({
                  ...config,
                  emailTemplates: { ...config.emailTemplates, [key]: e.target.value },
                })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/config/EmailTemplatesPage.tsx
git commit -m "feat(admin): extract EmailTemplatesPage from ConfigPage"
```

---

### Task 7: Create BillingPage

**Files:**
- Create: `frontend/src/pages/admin/BillingPage.tsx`

**Step 1: Create BillingPage.tsx**

Combines Stripe config (from old ConfigPage) with MRR and plan metrics (from OverviewPage). Top section is Stripe API config, bottom section is billing metrics.

```tsx
import { useState, useEffect } from 'react';
import { fetchStripeConfig, updateStripeConfig, fetchOverview } from '../../admin-api';
import type { StripeConfig, AdminOverview } from '../../admin-types';

export default function BillingPage() {
  const [stripe, setStripe] = useState<StripeConfig | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [stripeForm, setStripeForm] = useState({
    starterPriceId: '',
    proPriceId: '',
    publishableKey: '',
    secretKey: '',
    webhookSecret: '',
  });

  useEffect(() => {
    Promise.all([fetchStripeConfig(), fetchOverview()])
      .then(([s, o]) => {
        setStripe(s);
        setOverview(o);
        setStripeForm({
          starterPriceId: s.starterPriceId || '',
          proPriceId: s.proPriceId || '',
          publishableKey: '',
          secretKey: '',
          webhookSecret: '',
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const saveStripe = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateStripeConfig({
        starterPriceId: stripeForm.starterPriceId,
        proPriceId: stripeForm.proPriceId,
        ...(stripeForm.publishableKey ? { publishableKey: stripeForm.publishableKey } : {}),
        ...(stripeForm.secretKey ? { secretKey: stripeForm.secretKey } : {}),
        ...(stripeForm.webhookSecret ? { webhookSecret: stripeForm.webhookSecret } : {}),
      });
      const updated = await fetchStripeConfig();
      setStripe(updated);
      setStripeForm({
        starterPriceId: updated.starterPriceId || '',
        proPriceId: updated.proPriceId || '',
        publishableKey: '',
        secretKey: '',
        webhookSecret: '',
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

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Billing</h1>

      <div className="space-y-6">
        {/* Billing Metrics */}
        {overview && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-sm font-medium text-gray-500">MRR</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">${overview.mrr}</p>
              <p className="mt-1 text-xs text-gray-400">{overview.planCounts.starter}x$9 + {overview.planCounts.pro}x$19</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-sm font-medium text-gray-500">Starter</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{overview.planCounts.starter}</p>
              <p className="mt-1 text-xs text-gray-400">subscribers</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-sm font-medium text-gray-500">Pro</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">{overview.planCounts.pro}</p>
              <p className="mt-1 text-xs text-gray-400">subscribers</p>
            </div>
          </div>
        )}

        {/* Stripe Configuration */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Stripe Configuration</h2>
            <div className="flex items-center gap-3">
              {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
              <button onClick={saveStripe} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save Stripe'}
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Starter Price ID</label>
                <input
                  type="text"
                  value={stripeForm.starterPriceId}
                  onChange={(e) => setStripeForm({ ...stripeForm, starterPriceId: e.target.value })}
                  placeholder="price_..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pro Price ID</label>
                <input
                  type="text"
                  value={stripeForm.proPriceId}
                  onChange={(e) => setStripeForm({ ...stripeForm, proPriceId: e.target.value })}
                  placeholder="price_..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Publishable Key
                  {stripe?.hasPublishableKey && (
                    <span className="ml-2 text-xs text-gray-400">Current: {stripe.publishableKey}</span>
                  )}
                </label>
                <input
                  type="text"
                  value={stripeForm.publishableKey}
                  onChange={(e) => setStripeForm({ ...stripeForm, publishableKey: e.target.value })}
                  placeholder="Leave blank to keep current"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Secret Key
                  {stripe?.hasSecretKey && (
                    <span className="ml-2 text-xs text-gray-400">Current: {stripe.secretKey}</span>
                  )}
                </label>
                <input
                  type="password"
                  value={stripeForm.secretKey}
                  onChange={(e) => setStripeForm({ ...stripeForm, secretKey: e.target.value })}
                  placeholder="Leave blank to keep current"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook Secret
                  {stripe?.hasWebhookSecret && (
                    <span className="ml-2 text-xs text-gray-400">Current: {stripe.webhookSecret}</span>
                  )}
                </label>
                <input
                  type="password"
                  value={stripeForm.webhookSecret}
                  onChange={(e) => setStripeForm({ ...stripeForm, webhookSecret: e.target.value })}
                  placeholder="Leave blank to keep current"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/BillingPage.tsx
git commit -m "feat(admin): add BillingPage with Stripe config + metrics"
```

---

### Task 8: Slim down OverviewPage

**Files:**
- Modify: `frontend/src/pages/admin/OverviewPage.tsx`

**Step 1: Remove MRR card from OverviewPage**

Replace the `cards` array (lines 21-25) with only two cards — Total Users and Total Links. MRR has moved to BillingPage.

Change lines 21-25 from:
```tsx
  const cards = [
    { label: 'Total Users', value: data.totalUsers, sub: `Free: ${data.planCounts.free} / Starter: ${data.planCounts.starter} / Pro: ${data.planCounts.pro}` },
    { label: 'MRR', value: `$${data.mrr}`, sub: `${data.planCounts.starter}x$9 + ${data.planCounts.pro}x$19` },
    { label: 'Total Links', value: data.totalLinks, sub: Object.entries(data.statusCounts).map(([k, v]) => `${k}: ${v}`).join(' / ') },
  ];
```

To:
```tsx
  const cards = [
    { label: 'Total Users', value: data.totalUsers, sub: `Free: ${data.planCounts.free} / Starter: ${data.planCounts.starter} / Pro: ${data.planCounts.pro}` },
    { label: 'Total Links', value: data.totalLinks, sub: Object.entries(data.statusCounts).map(([k, v]) => `${k}: ${v}`).join(' / ') },
  ];
```

Also change the grid from `md:grid-cols-3` to `md:grid-cols-2` on line 30.

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/OverviewPage.tsx
git commit -m "refactor(admin): remove MRR from Overview (moved to Billing)"
```

---

### Task 9: Update AdminLayout sidebar with grouped nav

**Files:**
- Modify: `frontend/src/pages/admin/AdminLayout.tsx`

**Step 1: Replace the flat navItems with grouped sections**

Replace the entire file content. The new sidebar has three labeled groups (Platform, App Data, App Config) with section headers rendered as gray uppercase labels.

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken } from '../../admin-api';

const navGroups = [
  {
    label: 'Platform',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/users', label: 'Users' },
      { to: '/billing', label: 'Billing' },
      { to: '/health', label: 'Health' },
    ],
  },
  {
    label: 'App Data',
    items: [
      { to: '/data/links', label: 'Links' },
      { to: '/data/pitches', label: 'Pitches' },
    ],
  },
  {
    label: 'App Config',
    items: [
      { to: '/config/features', label: 'Feature Toggles' },
      { to: '/config/plans', label: 'Plan Limits' },
      { to: '/config/crawl', label: 'Crawl Settings' },
      { to: '/config/email', label: 'Email Templates' },
    ],
  },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminToken();
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-gray-700">
          <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          <span className="font-bold text-sm">YourApp Manager</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={'end' in item ? (item as any).end : undefined}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-2 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/pages/admin/AdminLayout.tsx
git commit -m "refactor(admin): grouped sidebar nav (Platform, App Data, App Config)"
```

---

### Task 10: Update App.tsx routes and delete old files

**Files:**
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/pages/admin/DataPage.tsx`
- Delete: `frontend/src/pages/admin/ConfigPage.tsx`

**Step 1: Update lazy imports and routes in App.tsx**

Replace the admin lazy imports (lines 20-26) with:

```tsx
// Admin pages — lazy loaded (only fetched on manager.yourapp.com)
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverview = lazy(() => import('./pages/admin/OverviewPage'));
const AdminUsers = lazy(() => import('./pages/admin/UsersPage'));
const AdminHealth = lazy(() => import('./pages/admin/HealthPage'));
const AdminBilling = lazy(() => import('./pages/admin/BillingPage'));
const AdminLinks = lazy(() => import('./pages/admin/data/LinksPage'));
const AdminPitches = lazy(() => import('./pages/admin/data/PitchesPage'));
const AdminFeatureToggles = lazy(() => import('./pages/admin/config/FeatureTogglesPage'));
const AdminPlanLimits = lazy(() => import('./pages/admin/config/PlanLimitsPage'));
const AdminCrawlSettings = lazy(() => import('./pages/admin/config/CrawlSettingsPage'));
const AdminEmailTemplates = lazy(() => import('./pages/admin/config/EmailTemplatesPage'));
```

Replace the admin Routes block (lines 69-75) with:

```tsx
        <Route element={<AdminLayout />}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="health" element={<AdminHealth />} />
          <Route path="data/links" element={<AdminLinks />} />
          <Route path="data/pitches" element={<AdminPitches />} />
          <Route path="config/features" element={<AdminFeatureToggles />} />
          <Route path="config/plans" element={<AdminPlanLimits />} />
          <Route path="config/crawl" element={<AdminCrawlSettings />} />
          <Route path="config/email" element={<AdminEmailTemplates />} />
        </Route>
```

**Step 2: Delete old files**

```bash
rm frontend/src/pages/admin/DataPage.tsx
rm frontend/src/pages/admin/ConfigPage.tsx
```

**Step 3: Verify it compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: clean compile, no errors

**Step 4: Verify the build**

```bash
cd frontend && npm run build
```

Expected: successful build with no errors

**Step 5: Commit**

```bash
git add -A frontend/src/App.tsx frontend/src/pages/admin/
git commit -m "refactor(admin): wire up new routes, delete old DataPage and ConfigPage"
```

---

### Task 11: Smoke test in dev server

**Step 1: Start the dev server**

```bash
cd frontend && npm run dev
```

**Step 2: Manually verify in browser**

Visit `http://localhost:5173` (or the manager host equivalent). Check:

1. Sidebar shows three groups: Platform, App Data, App Config
2. Each link navigates to its page without errors
3. Overview shows 2 cards (Users + Links), no MRR
4. Billing page shows MRR metrics + Stripe config form
5. Links page has search/filter/table
6. Pitches page has table
7. Feature Toggles page has toggle switches + save
8. Plan Limits page has inputs + save
9. Crawl Settings page has inputs + save
10. Email Templates page has template fields + save

**Step 3: Stop dev server when satisfied**
