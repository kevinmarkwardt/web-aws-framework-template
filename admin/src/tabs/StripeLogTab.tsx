import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, DataTable, Drawer, Input, JsonBlock, Loading, Notice, PageHeader, Panel, dateTime, useLoad, useTranslation, utcToday } from '@yourapp/shared';
import { api } from '../api';
import DayNav from '../components/DayNav';
import { userLink } from '../session';
import type { StripeCall, WebhookRow } from '../types';

function CallDetail({ c }: { c: StripeCall }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-faint">{t('admin.stripeLog.operation')}</dt><dd className="font-mono">{c.op}</dd></div>
        <div><dt className="text-xs text-faint">{t('admin.stripeLog.result')}</dt><dd>{t('admin.stripeLog.resultDetail', { outcome: c.ok ? t('admin.stripeLog.ok') : t('admin.stripeLog.failed'), http: c.httpStatus ?? '?', ms: c.ms })}</dd></div>
        <div><dt className="text-xs text-faint">{t('admin.stripeLog.triggeredBy')}</dt><dd>{c.actor ?? '—'}</dd></div>
        <div><dt className="text-xs text-faint">{t('admin.stripeLog.user')}</dt><dd>{c.userId ? <Link className="font-mono text-xs text-brand-700 hover:underline" to={userLink(c.userId)}>{c.userId}</Link> : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-faint">{t('admin.stripeLog.idempotencyKey')}</dt><dd className="font-mono text-xs break-all">{c.idempotencyKey || '—'}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-faint">{t('admin.stripeLog.stripeRequestId')}</dt><dd className="font-mono text-xs">{c.stripeRequestId || '—'}</dd></div>
      </dl>
      {c.error && <Notice tone="danger">{c.error}{c.errorCode ? ` (${c.errorCode})` : ''}</Notice>}
      <div><p className="mb-1 text-xs text-faint">{t('admin.stripeLog.request')}</p><JsonBlock value={c.request ?? '{}'} /></div>
      {c.response && <div><p className="mb-1 text-xs text-faint">{t('admin.stripeLog.response')}</p><JsonBlock value={c.response} /></div>}
    </div>
  );
}

function Calls({ day, failed, user }: { day: string; failed: boolean; user: string }) {
  const { t } = useTranslation();
  const { data, error } = useLoad(() => api.stripeLog({ day, failed, user }), [day, failed, user]);
  const [open, setOpen] = useState<StripeCall | null>(null);
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <>
      <DataTable
        rows={data.entries}
        rowKey={(c) => c.sk}
        onRowClick={setOpen}
        empty={t('admin.stripeLog.noCalls')}
        columns={[
          { key: 'at', header: t('admin.stripeLog.when'), render: (c) => <span className="whitespace-nowrap text-muted">{dateTime(c.at)}</span> },
          { key: 'op', header: t('admin.stripeLog.operation'), render: (c) => <span className="font-mono text-xs">{c.op}</span> },
          { key: 'ok', header: t('admin.stripeLog.result'), render: (c) => (c.ok ? <Badge tone="ok">{t('admin.stripeLog.ok')}</Badge> : <Badge tone="danger">{c.errorCode || `HTTP ${c.httpStatus ?? '?'}`}</Badge>) },
          { key: 'ms', header: t('admin.stripeLog.ms'), numeric: true, render: (c) => c.ms },
          { key: 'actor', header: t('admin.stripeLog.by'), render: (c) => <span className="text-xs text-muted">{c.actor}</span> },
          { key: 'obj', header: t('admin.stripeLog.object'), render: (c) => <span className="font-mono text-xs text-faint">{c.objectId}</span> },
        ]}
      />
      <Drawer open={!!open} title={t('admin.stripeLog.callTitle')} onClose={() => setOpen(null)}>{open && <CallDetail c={open} />}</Drawer>
    </>
  );
}

function Webhooks({ day, failed }: { day: string; failed: boolean }) {
  const { t } = useTranslation();
  const { data, error } = useLoad(() => api.webhooks({ day, failed }), [day, failed]);
  const [open, setOpen] = useState<WebhookRow | null>(null);
  const detail = useLoad(() => (open ? api.webhook(open.eventId) : Promise.resolve(null)), [open?.eventId ?? '']);
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <>
      <DataTable
        rows={data.entries}
        rowKey={(w) => w.sk}
        onRowClick={setOpen}
        empty={t('admin.stripeLog.noWebhooks')}
        columns={[
          { key: 'at', header: t('admin.stripeLog.received'), render: (w) => <span className="whitespace-nowrap text-muted">{dateTime(w.sk.split('#')[0])}</span> },
          { key: 'type', header: t('admin.stripeLog.event'), render: (w) => <span className="font-mono text-xs">{w.type}</span> },
          { key: 'status', header: t('admin.stripeLog.status'), render: (w) => <Badge tone={w.status === 'ok' ? 'ok' : w.status === 'failed' ? 'danger' : 'warn'}>{w.status}</Badge> },
          { key: 'result', header: t('admin.stripeLog.result'), render: (w) => <span className="text-muted">{w.result}</span> },
          { key: 'obj', header: t('admin.stripeLog.object'), render: (w) => <span className="font-mono text-xs text-faint">{w.objectId}</span> },
        ]}
      />
      <Drawer open={!!open} title={open?.type ?? t('admin.stripeLog.webhookTitle')} onClose={() => setOpen(null)}>
        {detail.data ? <JsonBlock value={detail.data} /> : <Loading />}
      </Drawer>
    </>
  );
}

/** Every call we made to Stripe (redacted request, outcome, idempotency key) and every webhook Stripe sent us, by UTC day.
 *  Kept 18 months, no personal data. */
export default function StripeLogTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || utcToday();
  const kind = params.get('kind') === 'webhooks' ? 'webhooks' : 'calls';
  const failed = params.get('failed') === '1';
  const user = params.get('user') || '';
  const [userText, setUserText] = useState(user);
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      if (v) p.set(k, v);
      else p.delete(k);
      return p;
    });
  return (
    <div>
      <PageHeader title={t('admin.stripeLog.title')} subtitle={t('admin.stripeLog.subtitle')} actions={<DayNav day={day} onChange={(d) => set('day', d)} />} />
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {(['calls', 'webhooks'] as const).map((k) => (
              <button key={k} onClick={() => set('kind', k === 'calls' ? null : k)}
                className={`rounded-md px-3 py-1 text-sm ${kind === k ? 'bg-brand-600 text-brand-ink' : 'text-muted hover:text-ink'}`}>
                {k === 'calls' ? t('admin.stripeLog.apiCalls') : t('admin.stripeLog.webhooks')}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={failed} onChange={(e) => set('failed', e.target.checked ? '1' : null)} /> {t('admin.stripeLog.failuresOnly')}
          </label>
          {kind === 'calls' && (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); set('user', userText.trim() || null); }}>
              <Input value={userText} onChange={(e) => setUserText(e.target.value)} placeholder={t('admin.stripeLog.userIdPlaceholder')} className="w-56 py-1" />
              <Button size="sm" type="submit">{t('admin.actions.filter')}</Button>
            </form>
          )}
        </div>
        {kind === 'calls' ? <Calls day={day} failed={failed} user={user} /> : <Webhooks day={day} failed={failed} />}
      </Panel>
    </div>
  );
}
