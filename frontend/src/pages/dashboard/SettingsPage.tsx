import { useContext, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Field, Input, LANGUAGES, Notice, Panel, Select, Toggle, currentLanguage, switchLanguage, useTranslation,
} from '@yourapp/shared';
import { AuthContext } from '../../auth-context';
import { updateSettings } from '../../api';
import { creditsOn, subscriptionsOn, units } from '../../billing';
import RestrictedNote from '../../components/RestrictedNote';
import type { Notifications, SettingsUpdate, User } from '../../types';

type Tab = 'profile' | 'payment' | 'notifications';

/** Account settings in three tabs (?tab=profile|payment|notifications), all stored by the API on the profile
 *  (PUT /api/account/settings, api/lib/prefs.py): nothing here lives only in the browser. */
export default function SettingsPage() {
  const { user } = useContext(AuthContext);
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  if (!user) return null;

  const billing = subscriptionsOn(user.billingMode) || creditsOn(user.billingMode);
  const tabs: Tab[] = ['profile', ...(billing ? ['payment' as const] : []), 'notifications'];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'profile';

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-ink mb-6">{t('settings.title')}</h1>
      <div role="tablist" aria-label={t('settings.title')} className="flex gap-1 border-b border-line mb-6">
        {tabs.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setParams(id === 'profile' ? {} : { tab: id }, { replace: true })}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t(`settings.tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'profile' && <ProfileTab user={user} />}
      {tab === 'payment' && <PaymentTab user={user} />}
      {tab === 'notifications' && <NotificationsTab user={user} />}
    </div>
  );
}

/** Save some settings, then reload the account so every page sees them. */
function useSave() {
  const { refresh } = useContext(AuthContext);
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const save = async (update: SettingsUpdate) => {
    setBusy(true);
    setStatus(null);
    try {
      await updateSettings(update);
      await refresh();
      setStatus({ tone: 'ok', text: t('settings.saved') });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof Error ? e.message : t('settings.saveFailed') });
    } finally {
      setBusy(false);
    }
  };
  return { busy, status, save };
}

function ProfileTab({ user }: { user: User }) {
  const { t } = useTranslation();
  const [name, setName] = useState(user.name);
  const [language, setLanguage] = useState(user.language || currentLanguage());
  const { busy, status, save } = useSave();
  const trimmed = name.trim();
  const changed = trimmed !== user.name || language !== user.language;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    const update: SettingsUpdate = {};
    if (trimmed !== user.name) update.name = trimmed;
    if (language !== user.language) update.language = language;
    await save(update);
    if (update.language) switchLanguage(update.language);
  };

  return (
    <Panel>
      <form onSubmit={submit} className="space-y-5 max-w-md">
        <Field label={t('settings.profile.name')} hint={!trimmed ? t('settings.profile.nameRequired') : undefined}>
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label={t('settings.profile.email')} hint={t('settings.profile.emailHint')}>
          <Input value={user.email} disabled readOnly />
        </Field>
        {/* only once the site has more than one language (packages/shared/src/i18n/languages.ts) */}
        {LANGUAGES.length > 1 && (
          <Field label={t('settings.profile.language')} hint={t('settings.profile.languageHint')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" busy={busy} disabled={!changed || !trimmed}>{t('settings.save')}</Button>
          {status && <Notice tone={status.tone}>{status.text}</Notice>}
        </div>
      </form>
    </Panel>
  );
}

/** Where money is handled for the billing modules that are on: the Plans page (subscriptions) and the Wallet page
 *  (credits: balance, cards, auto reload, refunds). */
function PaymentTab({ user }: { user: User }) {
  const { t } = useTranslation();
  const link = 'text-brand-600 hover:text-brand-700 font-medium';
  return (
    <div className="space-y-4">
      <RestrictedNote need="pay" />
      {subscriptionsOn(user.billingMode) && (
        <Panel title={t('settings.payment.planTitle')}>
          <p className="text-sm text-ink">
            {t('settings.payment.plan', { plan: user.plan })}
          </p>
          <p className="text-sm text-muted mt-1">{t('settings.payment.planHint')}</p>
          <Link to="/dashboard/plans" className={`inline-block mt-3 text-sm ${link}`}>{t('settings.payment.planLink')}</Link>
        </Panel>
      )}
      {creditsOn(user.billingMode) && (
        <Panel title={t('settings.payment.walletTitle')}>
          <p className="text-sm text-ink">
            {t('settings.payment.balance', { balance: units(user.credits ?? 0, user.creditName) })}
          </p>
          <p className="text-sm text-muted mt-1">{t('settings.payment.walletHint')}</p>
          <Link to="/dashboard/wallet" className={`inline-block mt-3 text-sm ${link}`}>{t('settings.payment.walletLink')}</Link>
        </Panel>
      )}
    </div>
  );
}

const NOTIFICATIONS: (keyof Notifications)[] = ['emailSupport', 'emailBilling', 'emailNews'];

function NotificationsTab({ user }: { user: User }) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<Notifications>(user.notifications);
  const { busy, status, save } = useSave();
  const changed = NOTIFICATIONS.some((k) => prefs[k] !== user.notifications[k]);
  return (
    <Panel>
      <p className="text-sm text-muted mb-2">{t('settings.notifications.intro')}</p>
      <div className="divide-y divide-line">
        {NOTIFICATIONS.map((k) => (
          <Toggle
            key={k}
            checked={prefs[k]}
            onChange={(v) => setPrefs({ ...prefs, [k]: v })}
            label={t(`settings.notifications.${k}.label`)}
            hint={t(`settings.notifications.${k}.hint`)}
          />
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" busy={busy} disabled={!changed} onClick={() => save({ notifications: prefs })}>
          {t('settings.save')}
        </Button>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
      </div>
    </Panel>
  );
}
