import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Field, Input, Loading, Notice, PageHeader, Panel, Toggle, creditsOn, subscriptionsOn, usd, useLoad, Trans, useTranslation } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { SiteConfig, StripeConfig } from '../types';

// label and hint are i18n keys
const TOGGLES: { key: 'maintenanceMode' | 'signupsEnabled' | 'jobsEnabled' | 'alertsEnabled'; label: string; hint: string }[] = [
  { key: 'maintenanceMode', label: 'admin.config.toggles.maintenanceMode', hint: 'admin.config.toggles.maintenanceModeHint' },
  { key: 'signupsEnabled', label: 'admin.config.toggles.signupsEnabled', hint: 'admin.config.toggles.signupsEnabledHint' },
  { key: 'jobsEnabled', label: 'admin.config.toggles.jobsEnabled', hint: 'admin.config.toggles.jobsEnabledHint' },
  { key: 'alertsEnabled', label: 'admin.config.toggles.alertsEnabled', hint: 'admin.config.toggles.alertsEnabledHint' },
];

/** One section of the site config, saved on its own (the API merges the sections it is sent). */
function Section({ title, children, dirty, onSave, note }:
  { title: string; children: ReactNode; dirty: boolean; onSave: () => Promise<void>; note?: ReactNode }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave();
      setMsg({ tone: 'ok', text: t('admin.config.saved') });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  return (
    <Panel title={title} actions={<Button size="sm" variant="primary" busy={busy} disabled={!dirty} onClick={save}>{t('admin.actions.save')}</Button>}>
      {note && <p className="mb-2 text-xs text-faint">{note}</p>}
      {children}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Panel>
  );
}

function SiteConfigForm({ initial }: { initial: SiteConfig }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const same = (k: keyof SiteConfig) => JSON.stringify(saved[k]) === JSON.stringify(draft[k]);
  const save = async (keys: (keyof SiteConfig)[]) => {
    const body = Object.fromEntries(keys.map((k) => [k, draft[k]])) as Partial<SiteConfig>;
    const out = await api.saveConfig(body);
    setSaved(out);
    setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, out[k]])) }));
  };
  const toggleKeys = TOGGLES.map((tg) => tg.key);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t('admin.config.switches')} dirty={!toggleKeys.every(same)} onSave={() => save(toggleKeys)}>
        <div className="divide-y divide-line">
          {TOGGLES.map((tg) => (
            <Toggle key={tg.key} label={<span className="flex items-center gap-2">{t(tg.label)}{tg.key === 'maintenanceMode' && draft.maintenanceMode && <Badge tone="danger">{t('admin.config.on')}</Badge>}</span>}
              hint={t(tg.hint)} checked={draft[tg.key]} onChange={(v) => setDraft((d) => ({ ...d, [tg.key]: v }))} />
          ))}
        </div>
      </Section>

      <Section title={t('admin.config.planLimits')} dirty={!same('planLimits')} onSave={() => save(['planLimits'])}
        note={t('admin.config.planLimitsNote')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Object.entries(draft.planLimits).map(([plan, limit]) => (
            <Field key={plan} label={<span className="capitalize">{plan}</span>}>
              <Input type="number" min={0} step={1} value={limit ?? ''} placeholder={t('admin.config.unlimited')}
                onChange={(e) => setDraft((d) => ({ ...d, planLimits: { ...d.planLimits, [plan]: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) } }))} />
            </Field>
          ))}
        </div>
      </Section>

      <Section title={t('admin.config.jobSettings')} dirty={!same('jobSettings')} onSave={() => save(['jobSettings'])}
        note={t('admin.config.jobSettingsNote')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.config.dailyJobHour')}>
            <Input type="number" min={0} max={23} value={draft.jobSettings.dailyJobHourUtc}
              onChange={(e) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, dailyJobHourUtc: Math.floor(Number(e.target.value) || 0) } }))} />
          </Field>
          <Field label={t('admin.config.rateLimitDelay')}>
            <Input type="number" min={0} step={100} value={draft.jobSettings.rateLimitDelayMs}
              onChange={(e) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, rateLimitDelayMs: Math.floor(Number(e.target.value) || 0) } }))} />
          </Field>
        </div>
        <Toggle label={t('admin.config.hourlyJob')} checked={draft.jobSettings.hourlyJobEnabled}
          onChange={(v) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, hourlyJobEnabled: v } }))} />
      </Section>

      <Section title={t('admin.config.emailSubjects')} dirty={!same('emailTemplates')} onSave={() => save(['emailTemplates'])}>
        <div className="space-y-3">
          {Object.entries(draft.emailTemplates).map(([k, v]) => (
            <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}>
              <Input value={v} onChange={(e) => setDraft((d) => ({ ...d, emailTemplates: { ...d.emailTemplates, [k]: e.target.value } }))} />
            </Field>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StripeForm({ initial }: { initial: StripeConfig }) {
  const { t } = useTranslation();
  const me = useMe();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.priceOverrides);
  const subs = subscriptionsOn(me.billingMode);
  return (
    <Section title={t('admin.config.stripe')} dirty={subs && JSON.stringify(draft) !== JSON.stringify(saved.priceOverrides)}
      onSave={async () => {
        const out = await api.saveStripeConfig(draft);
        setSaved(out);
        setDraft(out.priceOverrides);
      }}
      note={<Trans i18nKey="admin.config.stripeNote" values={{ stage: me.stage, secretName: saved.secretName }} components={{ code: <code /> }} />}>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge tone={saved.mode === 'live' ? 'danger' : saved.mode === 'test' ? 'ok' : 'warn'}>
          {saved.mode === 'missing' ? t('admin.config.noKey') : t('admin.config.modeKey', { mode: saved.mode })}
        </Badge>
        <Badge tone={saved.webhookSecret ? 'ok' : 'warn'}>{saved.webhookSecret ? t('admin.config.webhookSecretSet') : t('admin.config.noWebhookSecret')}</Badge>
      </div>
      {subs && (
        <div className="space-y-3">
          <p className="text-xs text-faint">{t('admin.config.priceOverrides')}</p>
          {Object.keys(draft).map((plan) => (
            <Field key={plan} label={<span className="capitalize">{plan}</span>}>
              <Input value={draft[plan]} placeholder="price_…" onChange={(e) => setDraft((d) => ({ ...d, [plan]: e.target.value.trim() }))} />
            </Field>
          ))}
        </div>
      )}
    </Section>
  );
}

function WhatIsSold() {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <Panel title={t('admin.config.whatIsSold')}>
      <p className="mb-3 text-xs text-faint">{t('admin.config.whatIsSoldNote')}</p>
      {me.billingMode === 'none' && <p className="text-sm text-muted">{t('admin.config.billingOff')}</p>}
      {subscriptionsOn(me.billingMode) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {me.plans.map((p) => <Badge key={p.id} tone="brand">{p.name}: {p.monthlyUsd ? t('admin.config.perMonth', { price: usd(p.monthlyUsd * 100) }) : t('admin.config.free')}</Badge>)}
        </div>
      )}
      {creditsOn(me.billingMode) && (
        <div className="flex flex-wrap gap-2">
          {me.packs.map((p) => <Badge key={p.id}>{usd(p.payCents)} → {p.credits.toLocaleString()} {me.creditName}{p.bonusPct ? ` (+${p.bonusPct}%)` : ''}</Badge>)}
        </div>
      )}
      <p className="mt-3 text-xs text-faint">
        {t('admin.config.accountRules', { warningDays: me.accountRules.warningDays, warningsToBan: me.accountRules.warningsToBan, banDays: me.accountRules.banDays })}
      </p>
    </Panel>
  );
}

/** Site config (CONFIG | GLOBAL: switches, plan limits, job settings, email subjects), Stripe status and price
 *  overrides, and a read-only summary of what is sold. Every save is in the audit log. */
export default function ConfigTab() {
  const { t } = useTranslation();
  const me = useMe();
  const site = useLoad(() => api.config(), []);
  const stripe = useLoad(() => (me.billingMode === 'none' ? Promise.resolve(null) : api.stripeConfig()), [me.billingMode]);
  return (
    <div>
      <PageHeader title={t('admin.config.title')} subtitle={t('admin.config.subtitle')} />
      {site.error && <Notice tone="danger" className="mb-4">{site.error}</Notice>}
      {!site.data ? <Loading /> : <SiteConfigForm initial={site.data} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {me.billingMode !== 'none' && (stripe.error ? <Notice tone="danger">{stripe.error}</Notice> : stripe.data ? <StripeForm initial={stripe.data} /> : <Loading />)}
        <WhatIsSold />
      </div>
    </div>
  );
}
