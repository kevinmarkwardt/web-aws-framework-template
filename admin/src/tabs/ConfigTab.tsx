import { useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, Field, Input, Loading, Notice, PageHeader, Panel, Toggle, creditsOn, subscriptionsOn, usd, useLoad } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { SiteConfig, StripeConfig } from '../types';

const TOGGLES: { key: 'maintenanceMode' | 'signupsEnabled' | 'jobsEnabled' | 'alertsEnabled'; label: string; hint: string }[] = [
  { key: 'maintenanceMode', label: 'Maintenance mode', hint: 'Every user API route answers 503. The admin site, webhooks and public config keep working.' },
  { key: 'signupsEnabled', label: 'Sign-ups open', hint: 'Off: new accounts are refused a profile; existing accounts are unaffected.' },
  { key: 'jobsEnabled', label: 'Scheduled jobs', hint: 'Off: lambdas/daily-job skips its run.' },
  { key: 'alertsEnabled', label: 'Alert emails', hint: 'For your own alert emails (the template sends none yet).' },
];

/** One section of the site config, saved on its own (the API merges the sections it is sent). */
function Section({ title, children, dirty, onSave, note }:
  { title: string; children: ReactNode; dirty: boolean; onSave: () => Promise<void>; note?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await onSave();
      setMsg({ tone: 'ok', text: 'Saved. Other servers pick it up within 30 seconds.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  return (
    <Panel title={title} actions={<Button size="sm" variant="primary" busy={busy} disabled={!dirty} onClick={save}>Save</Button>}>
      {note && <p className="mb-2 text-xs text-faint">{note}</p>}
      {children}
      {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
    </Panel>
  );
}

function SiteConfigForm({ initial }: { initial: SiteConfig }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const same = (k: keyof SiteConfig) => JSON.stringify(saved[k]) === JSON.stringify(draft[k]);
  const save = async (keys: (keyof SiteConfig)[]) => {
    const body = Object.fromEntries(keys.map((k) => [k, draft[k]])) as Partial<SiteConfig>;
    const out = await api.saveConfig(body);
    setSaved(out);
    setDraft((d) => ({ ...d, ...Object.fromEntries(keys.map((k) => [k, out[k]])) }));
  };
  const toggleKeys = TOGGLES.map((t) => t.key);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Switches" dirty={!toggleKeys.every(same)} onSave={() => save(toggleKeys)}>
        <div className="divide-y divide-line">
          {TOGGLES.map((t) => (
            <Toggle key={t.key} label={<span className="flex items-center gap-2">{t.label}{t.key === 'maintenanceMode' && draft.maintenanceMode && <Badge tone="danger">on</Badge>}</span>}
              hint={t.hint} checked={draft[t.key]} onChange={(v) => setDraft((d) => ({ ...d, [t.key]: v }))} />
          ))}
        </div>
      </Section>

      <Section title="Plan item limits" dirty={!same('planLimits')} onSave={() => save(['planLimits'])}
        note="The only source of item limits: the API enforces them and the site shows them. Empty = unlimited.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Object.entries(draft.planLimits).map(([plan, limit]) => (
            <Field key={plan} label={<span className="capitalize">{plan}</span>}>
              <Input type="number" min={0} step={1} value={limit ?? ''} placeholder="Unlimited"
                onChange={(e) => setDraft((d) => ({ ...d, planLimits: { ...d.planLimits, [plan]: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) } }))} />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Job settings" dirty={!same('jobSettings')} onSave={() => save(['jobSettings'])}
        note="Read by lambdas/daily-job. The schedule itself is the EventBridge rule in the CDK stack.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily job hour (UTC)">
            <Input type="number" min={0} max={23} value={draft.jobSettings.dailyJobHourUtc}
              onChange={(e) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, dailyJobHourUtc: Math.floor(Number(e.target.value) || 0) } }))} />
          </Field>
          <Field label="Delay between calls (ms)">
            <Input type="number" min={0} step={100} value={draft.jobSettings.rateLimitDelayMs}
              onChange={(e) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, rateLimitDelayMs: Math.floor(Number(e.target.value) || 0) } }))} />
          </Field>
        </div>
        <Toggle label="Hourly job" checked={draft.jobSettings.hourlyJobEnabled}
          onChange={(v) => setDraft((d) => ({ ...d, jobSettings: { ...d.jobSettings, hourlyJobEnabled: v } }))} />
      </Section>

      <Section title="Email subjects" dirty={!same('emailTemplates')} onSave={() => save(['emailTemplates'])}>
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
  const me = useMe();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.priceOverrides);
  const subs = subscriptionsOn(me.billingMode);
  return (
    <Section title="Stripe" dirty={subs && JSON.stringify(draft) !== JSON.stringify(saved.priceOverrides)}
      onSave={async () => {
        const out = await api.saveStripeConfig(draft);
        setSaved(out);
        setDraft(out.priceOverrides);
      }}
      note={<>Keys are never shown or edited here: <code>scripts/stripe-secret.sh {me.stage}</code> writes them to {saved.secretName}.</>}>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Badge tone={saved.mode === 'live' ? 'danger' : saved.mode === 'test' ? 'ok' : 'warn'}>
          {saved.mode === 'missing' ? 'No key stored' : `${saved.mode} key`}
        </Badge>
        <Badge tone={saved.webhookSecret ? 'ok' : 'warn'}>{saved.webhookSecret ? 'Webhook secret set' : 'No webhook secret (scripts/stripe-setup.py)'}</Badge>
      </div>
      {subs && (
        <div className="space-y-3">
          <p className="text-xs text-faint">Plan price overrides. Empty uses the price whose lookup key is yourapp_plan_&lt;plan&gt; (scripts/stripe-setup.py).</p>
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
  const me = useMe();
  return (
    <Panel title="What the site sells (code config)">
      <p className="mb-3 text-xs text-faint">Set in api/lib/config.py from the site spec; change it there and deploy.</p>
      {me.billingMode === 'none' && <p className="text-sm text-muted">Billing is off.</p>}
      {subscriptionsOn(me.billingMode) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {me.plans.map((p) => <Badge key={p.id} tone="brand">{p.name}: {p.monthlyUsd ? `${usd(p.monthlyUsd * 100)}/mo` : 'free'}</Badge>)}
        </div>
      )}
      {creditsOn(me.billingMode) && (
        <div className="flex flex-wrap gap-2">
          {me.packs.map((p) => <Badge key={p.id}>{usd(p.payCents)} → {p.credits.toLocaleString()} {me.creditName}{p.bonusPct ? ` (+${p.bonusPct}%)` : ''}</Badge>)}
        </div>
      )}
      <p className="mt-3 text-xs text-faint">
        Account rules: warnings expire after {me.accountRules.warningDays} days; {me.accountRules.warningsToBan} active warnings ban for {me.accountRules.banDays} days.
      </p>
    </Panel>
  );
}

/** Site config (CONFIG | GLOBAL: switches, plan limits, job settings, email subjects), Stripe status and price
 *  overrides, and a read-only summary of what is sold. Every save is in the audit log. */
export default function ConfigTab() {
  const me = useMe();
  const site = useLoad(() => api.config(), []);
  const stripe = useLoad(() => (me.billingMode === 'none' ? Promise.resolve(null) : api.stripeConfig()), [me.billingMode]);
  return (
    <div>
      <PageHeader title="Config" subtitle="Changes apply to the live site. Each save is recorded in the audit log." />
      {site.error && <Notice tone="danger" className="mb-4">{site.error}</Notice>}
      {!site.data ? <Loading /> : <SiteConfigForm initial={site.data} />}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {me.billingMode !== 'none' && (stripe.error ? <Notice tone="danger">{stripe.error}</Notice> : stripe.data ? <StripeForm initial={stripe.data} /> : <Loading />)}
        <WhatIsSold />
      </div>
    </div>
  );
}
