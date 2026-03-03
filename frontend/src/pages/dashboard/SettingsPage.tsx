import { useState, useContext } from 'react';
import { AuthContext } from '../../App';
import { updateSettings, updateName, createPortalSession, createCheckoutSession, changePlan, cancelPlan } from '../../api';
import type { Plan } from '../../types';

const planDetails: Record<Plan, { name: string; price: string; features: string[]; limit: number | null }> = {
  free: {
    name: 'Free',
    price: '$0/month',
    features: ['5 monitored links', 'Daily crawls', 'Instant alerts', 'Weekly digest'],
    limit: 5,
  },
  starter: {
    name: 'Starter',
    price: '$9/month',
    features: ['50 monitored links', 'Daily crawls', 'Pipeline tracker'],
    limit: 50,
  },
  pro: {
    name: 'Pro',
    price: '$19/month',
    features: ['Unlimited links', 'Hourly crawls', 'AI scoring', 'Monthly reports'],
    limit: null,
  },
};

const PLAN_ORDER: Plan[] = ['free', 'starter', 'pro'];
const PLAN_RANK: Record<Plan, number> = { free: 0, starter: 1, pro: 2 };

export default function SettingsPage() {
  const { user, refresh } = useContext(AuthContext);
  const [alerts, setAlerts] = useState(user?.settings.alertsEnabled ?? true);
  const [digest, setDigest] = useState(user?.settings.digestEnabled ?? true);
  const [reminders, setReminders] = useState(user?.settings.remindersEnabled ?? true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [planError, setPlanError] = useState('');

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      setNameError('Name cannot be empty.');
      return;
    }
    setSavingName(true);
    setNameError('');
    setNameSaved(false);
    try {
      await updateName(trimmed);
      await refresh();
      setEditingName(false);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (err: any) {
      setNameError(err.message || 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings({
        alertsEnabled: alerts,
        digestEnabled: digest,
        remindersEnabled: reminders,
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Error handled by api
    } finally {
      setSaving(false);
    }
  };

  const handleManageBilling = async () => {
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch {
      // Error handled by api
    }
  };

  const handleChangePlan = async (targetPlan: Plan) => {
    setPlanError('');

    if (targetPlan === 'free') {
      setShowCancelConfirm(true);
      return;
    }

    setLoadingPlan(targetPlan);
    try {
      const result = await changePlan(targetPlan);
      if (result.action === 'checkout') {
        const { url } = await createCheckoutSession(targetPlan as 'starter' | 'pro');
        window.location.href = url;
      } else {
        await refresh();
      }
    } catch (err: any) {
      setPlanError(err.message || 'Failed to change plan');
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleCancelConfirm = async () => {
    setShowCancelConfirm(false);
    setLoadingPlan('free');
    setPlanError('');
    try {
      await cancelPlan();
      await refresh();
    } catch (err: any) {
      setPlanError(err.message || 'Failed to cancel subscription');
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlan = user?.plan || 'free';
  const itemCount = user?.itemCount || 0;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

      {/* Account Info */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">Name</p>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setEditingName(false); setNameValue(user?.name || ''); setNameError(''); } }}
                  maxLength={100}
                  autoFocus
                  className="text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64"
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {savingName ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditingName(false); setNameValue(user?.name || ''); setNameError(''); }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-gray-900">{user?.name || '—'}</p>
                <button
                  onClick={() => { setEditingName(true); setNameValue(user?.name || ''); setNameError(''); }}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Edit
                </button>
                {nameSaved && <span className="text-xs text-green-600">Saved</span>}
              </div>
            )}
            {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
          </div>
          <div>
            <p className="text-xs text-gray-500">Email</p>
            <p className="text-sm text-gray-900">{user?.email}</p>
          </div>
        </div>
      </section>

      {/* Plan Management */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan</h2>

        {planError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {planError}
          </div>
        )}

        {showCancelConfirm && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-medium text-amber-900 mb-3">
              Are you sure you want to cancel your subscription? You'll be downgraded to the free plan (5 links).
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleCancelConfirm}
                disabled={loadingPlan !== null}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                {loadingPlan === 'free' ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Canceling...
                  </span>
                ) : 'Cancel Subscription'}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-300"
              >
                Keep Plan
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_ORDER.map((plan) => {
            const details = planDetails[plan];
            const isCurrent = currentPlan === plan;
            const isHigher = PLAN_RANK[plan] > PLAN_RANK[currentPlan];
            const isLower = PLAN_RANK[plan] < PLAN_RANK[currentPlan];
            const targetLimit = details.limit;
            const overLimit = targetLimit !== null && itemCount > targetLimit;
            const isLoading = loadingPlan === plan;

            return (
              <div
                key={plan}
                className={`relative rounded-xl border-2 p-5 transition-colors ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-50/50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-3 left-4 bg-indigo-600 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">
                    Current Plan
                  </span>
                )}
                <h3 className="text-lg font-bold text-gray-900">{details.name}</h3>
                <p className="text-2xl font-bold text-gray-900 mt-1">{details.price}</p>
                <ul className="mt-4 space-y-2">
                  {details.features.map((f) => (
                    <li key={f} className="text-sm text-gray-600 flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  {isCurrent ? (
                    <div className="h-10" />
                  ) : isHigher ? (
                    <button
                      onClick={() => handleChangePlan(plan)}
                      disabled={isLoading || loadingPlan !== null}
                      className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {isLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          Upgrading...
                        </span>
                      ) : 'Upgrade'}
                    </button>
                  ) : isLower ? (
                    <>
                      <button
                        onClick={() => handleChangePlan(plan)}
                        disabled={overLimit || isLoading || loadingPlan !== null}
                        className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg border border-gray-300 disabled:opacity-50 transition-colors"
                      >
                        {isLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            {plan === 'free' ? 'Canceling...' : 'Downgrading...'}
                          </span>
                        ) : plan === 'free' ? 'Cancel Subscription' : 'Downgrade'}
                      </button>
                      {overLimit && targetLimit !== null && (
                        <p className="mt-2 text-xs text-amber-700">
                          You have {itemCount} items (limit: {targetLimit}). Remove{' '}
                          {itemCount - targetLimit} to downgrade.
                        </p>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {currentPlan !== 'free' && (
          <div className="mt-4">
            <button
              onClick={handleManageBilling}
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              Manage Billing &rarr;
            </button>
          </div>
        )}
      </section>

      {/* Notification Preferences */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Notifications</h2>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Status change alerts</p>
              <p className="text-xs text-gray-500">
                Get emailed when a link changes status
              </p>
            </div>
            <input
              type="checkbox"
              checked={alerts}
              onChange={(e) => setAlerts(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Weekly digest</p>
              <p className="text-xs text-gray-500">Monday morning summary of all links</p>
            </div>
            <input
              type="checkbox"
              checked={digest}
              onChange={(e) => setDigest(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Pipeline reminders</p>
              <p className="text-xs text-gray-500">
                Follow-up reminders for stale pitches
              </p>
            </div>
            <input
              type="checkbox"
              checked={reminders}
              onChange={(e) => setReminders(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
            />
          </label>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </section>
    </div>
  );
}
