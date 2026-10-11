import { useState } from 'react';
import { Badge, Button, DataTable, Dialog, Loading, Notice, PageHeader, Panel, Stat, bytes, creditsOn, dateTime, num, useLoad } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { Health, LambdaHealth } from '../types';

const failed = <T extends object>(x: T | { error: string }): x is { error: string } => 'error' in x;

function Tasks() {
  const me = useMe();
  const [task, setTask] = useState<'daily-job' | 'payments-sweep' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const run = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const out = await api.runTask(task);
      setMsg({ tone: 'ok', text: `${task}: ${JSON.stringify(out)}` });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
    setTask(null);
  };
  return (
    <Panel title="Run a scheduled task now">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setTask('daily-job')}>Run the daily job</Button>
        {creditsOn(me.billingMode) && <Button onClick={() => setTask('payments-sweep')}>Settle pending card refunds</Button>}
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3 break-all">{msg.text}</Notice>}
      <Dialog open={!!task} title="Run it now?" onClose={() => setTask(null)}
        footer={<><Button onClick={() => setTask(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={run}>Run</Button></>}>
        <p className="text-sm text-muted">
          {task === 'daily-job' ? 'Starts lambdas/daily-job in the background, as its schedule would.'
            : 'Asks Stripe about every card refund that is still pending and settles it (the PaymentsSweep schedule does this every 15 minutes).'}
          {' '}This is recorded in the audit log.
        </p>
      </Dialog>
    </Panel>
  );
}

/** Lambda, DynamoDB and SES for this stage over the last 24 hours (resource names come from the stack, not the code). */
export default function HealthTab() {
  const { data: h, error, reload, loading } = useLoad(() => api.health(), []);
  return (
    <div>
      <PageHeader title="Health" subtitle={h ? `${h.stage} · ${h.region} · ${dateTime(h.at)}` : 'Last 24 hours'}
        actions={<Button size="sm" busy={loading && !!h} onClick={reload}>Refresh</Button>} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!h ? <Loading /> : <Sections h={h} />}
      <div className="mt-6"><Tasks /></div>
    </div>
  );
}

function Sections({ h }: { h: Health }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Failed webhooks today" value={num(h.app.failedWebhooksToday)} tone={h.app.failedWebhooksToday ? 'danger' : 'ok'} />
        <Stat label="Card refunds pending" value={num(h.app.pendingRefunds)} tone={h.app.pendingRefunds ? 'warn' : undefined} />
        <Stat label="Open support requests" value={num(h.app.openSupport)} />
      </div>

      <Panel title="Lambda (24 h)" padded={false}>
        {failed(h.lambda) ? <Notice tone="danger" className="m-3">{h.lambda.error}</Notice> : (
          <DataTable<[string, LambdaHealth]>
            rows={Object.entries(h.lambda)}
            rowKey={([k]) => k}
            empty="No functions configured (API_FUNCTION_NAME / DAILY_JOB_FUNCTION are unset)."
            columns={[
              { key: 'name', header: 'Function', render: ([k, f]) => <div><div className="font-medium">{k}</div><div className="font-mono text-xs text-faint">{f.function}</div></div> },
              { key: 'inv', header: 'Invocations', numeric: true, render: ([, f]) => num(f.invocations) },
              { key: 'err', header: 'Errors', numeric: true, render: ([, f]) => <span className={f.errors ? 'text-danger font-medium' : ''}>{num(f.errors)}</span> },
              { key: 'thr', header: 'Throttles', numeric: true, render: ([, f]) => <span className={f.throttles ? 'text-warn font-medium' : ''}>{num(f.throttles)}</span> },
              { key: 'avg', header: 'Avg ms', numeric: true, render: ([, f]) => f.avgMs },
              { key: 'p95', header: 'p95 ms', numeric: true, render: ([, f]) => f.p95Ms },
            ]}
          />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="DynamoDB">
          {failed(h.dynamodb) ? <Notice tone="danger">{h.dynamodb.error}</Notice> : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-faint">Table</dt><dd className="font-mono text-xs">{h.dynamodb.table}</dd></div>
              <div><dt className="text-xs text-faint">Status</dt><dd><Badge tone={h.dynamodb.status === 'ACTIVE' ? 'ok' : 'warn'}>{h.dynamodb.status}</Badge></dd></div>
              <div><dt className="text-xs text-faint">Items (approx.)</dt><dd>{num(h.dynamodb.itemCount)}</dd></div>
              <div><dt className="text-xs text-faint">Size (approx.)</dt><dd>{bytes(h.dynamodb.sizeBytes)}</dd></div>
              <div><dt className="text-xs text-faint">Billing</dt><dd>{h.dynamodb.billing}</dd></div>
              <div><dt className="text-xs text-faint">Throttled (24 h)</dt><dd className={h.dynamodb.throttled24h ? 'text-danger' : ''}>{num(h.dynamodb.throttled24h)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-faint">Indexes</dt><dd>{h.dynamodb.indexes.map((i) => `${i.name} (${i.status})`).join(', ') || '—'}</dd></div>
            </dl>
          )}
        </Panel>
        <Panel title="SES (email)">
          {failed(h.ses) ? <Notice tone="danger">{h.ses.error}</Notice> : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2"><dt className="text-xs text-faint">Sender</dt><dd>{h.ses.sender}</dd></div>
              <div><dt className="text-xs text-faint">Sent, last 24 h</dt><dd>{num(h.ses.sent24h)} of {num(h.ses.max24h)}</dd></div>
              <div><dt className="text-xs text-faint">Production access</dt><dd>{h.ses.productionAccess === null ? '?' : h.ses.productionAccess ? 'Yes' : <span className="text-warn">No (sandbox)</span>}</dd></div>
              <div><dt className="text-xs text-faint">Bounces, 14 days</dt><dd className={h.ses.last14d.bounces ? 'text-warn' : ''}>{num(h.ses.last14d.bounces)} of {num(h.ses.last14d.deliveryattempts)}</dd></div>
              <div><dt className="text-xs text-faint">Complaints, 14 days</dt><dd className={h.ses.last14d.complaints ? 'text-danger' : ''}>{num(h.ses.last14d.complaints)}</dd></div>
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
