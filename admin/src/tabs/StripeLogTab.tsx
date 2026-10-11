import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, DataTable, Drawer, Input, JsonBlock, Loading, Notice, PageHeader, Panel, dateTime, useLoad, utcToday } from '@yourapp/shared';
import { api } from '../api';
import DayNav from '../components/DayNav';
import { userLink } from '../session';
import type { StripeCall, WebhookRow } from '../types';

function CallDetail({ c }: { c: StripeCall }) {
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-faint">Operation</dt><dd className="font-mono">{c.op}</dd></div>
        <div><dt className="text-xs text-faint">Result</dt><dd>{c.ok ? 'OK' : 'Failed'} · HTTP {c.httpStatus ?? '?'} · {c.ms} ms</dd></div>
        <div><dt className="text-xs text-faint">Triggered by</dt><dd>{c.actor ?? '—'}</dd></div>
        <div><dt className="text-xs text-faint">User</dt><dd>{c.userId ? <Link className="font-mono text-xs text-brand-700 hover:underline" to={userLink(c.userId)}>{c.userId}</Link> : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-faint">Idempotency key</dt><dd className="font-mono text-xs break-all">{c.idempotencyKey || '—'}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-faint">Stripe request id</dt><dd className="font-mono text-xs">{c.stripeRequestId || '—'}</dd></div>
      </dl>
      {c.error && <Notice tone="danger">{c.error}{c.errorCode ? ` (${c.errorCode})` : ''}</Notice>}
      <div><p className="mb-1 text-xs text-faint">Request (redacted)</p><JsonBlock value={c.request ?? '{}'} /></div>
      {c.response && <div><p className="mb-1 text-xs text-faint">Response (ids, amounts, states)</p><JsonBlock value={c.response} /></div>}
    </div>
  );
}

function Calls({ day, failed, user }: { day: string; failed: boolean; user: string }) {
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
        empty="No Stripe calls that day."
        columns={[
          { key: 'at', header: 'When', render: (c) => <span className="whitespace-nowrap text-muted">{dateTime(c.at)}</span> },
          { key: 'op', header: 'Operation', render: (c) => <span className="font-mono text-xs">{c.op}</span> },
          { key: 'ok', header: 'Result', render: (c) => (c.ok ? <Badge tone="ok">OK</Badge> : <Badge tone="danger">{c.errorCode || `HTTP ${c.httpStatus ?? '?'}`}</Badge>) },
          { key: 'ms', header: 'ms', numeric: true, render: (c) => c.ms },
          { key: 'actor', header: 'By', render: (c) => <span className="text-xs text-muted">{c.actor}</span> },
          { key: 'obj', header: 'Object', render: (c) => <span className="font-mono text-xs text-faint">{c.objectId}</span> },
        ]}
      />
      <Drawer open={!!open} title="Stripe call" onClose={() => setOpen(null)}>{open && <CallDetail c={open} />}</Drawer>
    </>
  );
}

function Webhooks({ day, failed }: { day: string; failed: boolean }) {
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
        empty="No webhooks that day."
        columns={[
          { key: 'at', header: 'Received', render: (w) => <span className="whitespace-nowrap text-muted">{dateTime(w.sk.split('#')[0])}</span> },
          { key: 'type', header: 'Event', render: (w) => <span className="font-mono text-xs">{w.type}</span> },
          { key: 'status', header: 'Status', render: (w) => <Badge tone={w.status === 'ok' ? 'ok' : w.status === 'failed' ? 'danger' : 'warn'}>{w.status}</Badge> },
          { key: 'result', header: 'Result', render: (w) => <span className="text-muted">{w.result}</span> },
          { key: 'obj', header: 'Object', render: (w) => <span className="font-mono text-xs text-faint">{w.objectId}</span> },
        ]}
      />
      <Drawer open={!!open} title={open?.type ?? 'Webhook'} onClose={() => setOpen(null)}>
        {detail.data ? <JsonBlock value={detail.data} /> : <Loading />}
      </Drawer>
    </>
  );
}

/** Every call we made to Stripe (redacted request, outcome, idempotency key) and every webhook Stripe sent us, by UTC day.
 *  Kept 18 months, no personal data. */
export default function StripeLogTab() {
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
      <PageHeader title="Stripe log" subtitle="Our calls to Stripe and Stripe's webhooks, by UTC day." actions={<DayNav day={day} onChange={(d) => set('day', d)} />} />
      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {(['calls', 'webhooks'] as const).map((k) => (
              <button key={k} onClick={() => set('kind', k === 'calls' ? null : k)}
                className={`rounded-md px-3 py-1 text-sm ${kind === k ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
                {k === 'calls' ? 'API calls' : 'Webhooks'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={failed} onChange={(e) => set('failed', e.target.checked ? '1' : null)} /> Failures only
          </label>
          {kind === 'calls' && (
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); set('user', userText.trim() || null); }}>
              <Input value={userText} onChange={(e) => setUserText(e.target.value)} placeholder="User id" className="w-56 py-1" />
              <Button size="sm" type="submit">Filter</Button>
            </form>
          )}
        </div>
        {kind === 'calls' ? <Calls day={day} failed={failed} user={user} /> : <Webhooks day={day} failed={failed} />}
      </Panel>
    </div>
  );
}
