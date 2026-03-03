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
