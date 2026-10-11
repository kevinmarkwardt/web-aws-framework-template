import { useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../auth-context';
import { updateSettings, updateName } from '../../api';
import { creditsOn, subscriptionsOn, units } from '../../billing';

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
    } catch (err) {
      setNameError((err as Error).message || 'Failed to update name');
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

      {/* Billing: the Plans and Wallet pages (shown only for the billing modules that are on) */}
      {(subscriptionsOn(user?.billingMode) || creditsOn(user?.billingMode)) && (
        <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing</h2>
          <div className="space-y-2 text-sm">
            {subscriptionsOn(user?.billingMode) && (
              <p>
                Plan: <span className="font-medium capitalize">{user?.plan}</span>.{' '}
                <Link to="/dashboard/plans" className="text-indigo-600 hover:text-indigo-700 font-medium">Change plan</Link>
              </p>
            )}
            {creditsOn(user?.billingMode) && (
              <p>
                Balance: <span className="font-medium">{units(user?.credits ?? 0, user?.creditName)}</span>.{' '}
                <Link to="/dashboard/wallet" className="text-indigo-600 hover:text-indigo-700 font-medium">Wallet, cards and refunds</Link>
              </p>
            )}
          </div>
        </section>
      )}

      {/* Notification Preferences */}
      <section className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Notifications</h2>
        <div className="space-y-4">
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Status change alerts</p>
              <p className="text-xs text-gray-500">
                Get emailed when an item changes status
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
              <p className="text-xs text-gray-500">Weekly summary digest</p>
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
              <p className="text-sm font-medium text-gray-900">Reminders</p>
              <p className="text-xs text-gray-500">
                Periodic reminders and notifications
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
