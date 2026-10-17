import { useState } from 'react';
import { Badge, Button, DataTable, Dialog, Loading, Notice, PageHeader, Panel, Stat, bytes, creditsOn, dateTime, num, useLoad, useTranslation } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { Health, LambdaHealth } from '../types';

const failed = <T extends object>(x: T | { error: string }): x is { error: string } => 'error' in x;

function Tasks() {
  const { t } = useTranslation();
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
    <Panel title={t('admin.health.tasksTitle')}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setTask('daily-job')}>{t('admin.health.runDailyJob')}</Button>
        {creditsOn(me.billingMode) && <Button onClick={() => setTask('payments-sweep')}>{t('admin.health.settleRefunds')}</Button>}
      </div>
      {msg && <Notice tone={msg.tone} className="mt-3 break-all">{msg.text}</Notice>}
      <Dialog open={!!task} title={t('admin.health.confirmTitle')} onClose={() => setTask(null)}
        footer={<><Button onClick={() => setTask(null)}>{t('admin.actions.cancel')}</Button><Button variant="primary" busy={busy} onClick={run}>{t('admin.actions.run')}</Button></>}>
        <p className="text-sm text-muted">
          {task === 'daily-job' ? t('admin.health.dailyJobBody') : t('admin.health.sweepBody')}
          {' '}{t('admin.health.audited')}
        </p>
      </Dialog>
    </Panel>
  );
}

/** Lambda, DynamoDB and SES for this stage over the last 24 hours (resource names come from the stack, not the code). */
export default function HealthTab() {
  const { t } = useTranslation();
  const { data: h, error, reload, loading } = useLoad(() => api.health(), []);
  return (
    <div>
      <PageHeader title={t('admin.health.title')} subtitle={h ? `${h.stage} · ${h.region} · ${dateTime(h.at)}` : t('admin.health.last24h')}
        actions={<Button size="sm" busy={loading && !!h} onClick={reload}>{t('admin.actions.refresh')}</Button>} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!h ? <Loading /> : <Sections h={h} />}
      <div className="mt-6"><Tasks /></div>
    </div>
  );
}

function Sections({ h }: { h: Health }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('admin.health.failedWebhooksToday')} value={num(h.app.failedWebhooksToday)} tone={h.app.failedWebhooksToday ? 'danger' : 'ok'} />
        <Stat label={t('admin.health.refundsPending')} value={num(h.app.pendingRefunds)} tone={h.app.pendingRefunds ? 'warn' : undefined} />
        <Stat label={t('admin.health.openSupport')} value={num(h.app.openSupport)} />
      </div>

      <Panel title={t('admin.health.lambda')} padded={false}>
        {failed(h.lambda) ? <Notice tone="danger" className="m-3">{h.lambda.error}</Notice> : (
          <DataTable<[string, LambdaHealth]>
            rows={Object.entries(h.lambda)}
            rowKey={([k]) => k}
            empty={t('admin.health.noFunctions')}
            columns={[
              { key: 'name', header: t('admin.health.function'), render: ([k, f]) => <div><div className="font-medium">{k}</div><div className="font-mono text-xs text-faint">{f.function}</div></div> },
              { key: 'inv', header: t('admin.health.invocations'), numeric: true, render: ([, f]) => num(f.invocations) },
              { key: 'err', header: t('admin.health.errors'), numeric: true, render: ([, f]) => <span className={f.errors ? 'text-danger font-medium' : ''}>{num(f.errors)}</span> },
              { key: 'thr', header: t('admin.health.throttles'), numeric: true, render: ([, f]) => <span className={f.throttles ? 'text-warn font-medium' : ''}>{num(f.throttles)}</span> },
              { key: 'avg', header: t('admin.health.avgMs'), numeric: true, render: ([, f]) => f.avgMs },
              { key: 'p95', header: t('admin.health.p95Ms'), numeric: true, render: ([, f]) => f.p95Ms },
            ]}
          />
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t('admin.health.dynamodb')}>
          {failed(h.dynamodb) ? <Notice tone="danger">{h.dynamodb.error}</Notice> : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-faint">{t('admin.health.table')}</dt><dd className="font-mono text-xs">{h.dynamodb.table}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.status')}</dt><dd><Badge tone={h.dynamodb.status === 'ACTIVE' ? 'ok' : 'warn'}>{h.dynamodb.status}</Badge></dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.items')}</dt><dd>{num(h.dynamodb.itemCount)}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.size')}</dt><dd>{bytes(h.dynamodb.sizeBytes)}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.billing')}</dt><dd>{h.dynamodb.billing}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.throttled')}</dt><dd className={h.dynamodb.throttled24h ? 'text-danger' : ''}>{num(h.dynamodb.throttled24h)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-faint">{t('admin.health.indexes')}</dt><dd>{h.dynamodb.indexes.map((i) => `${i.name} (${i.status})`).join(', ') || '—'}</dd></div>
            </dl>
          )}
        </Panel>
        <Panel title={t('admin.health.ses')}>
          {failed(h.ses) ? <Notice tone="danger">{h.ses.error}</Notice> : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2"><dt className="text-xs text-faint">{t('admin.health.sender')}</dt><dd>{h.ses.sender}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.sent')}</dt><dd>{t('admin.health.ofTotal', { n: num(h.ses.sent24h), total: num(h.ses.max24h) })}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.productionAccess')}</dt><dd>{h.ses.productionAccess === null ? '?' : h.ses.productionAccess ? t('admin.health.yes') : <span className="text-warn">{t('admin.health.noSandbox')}</span>}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.bounces')}</dt><dd className={h.ses.last14d.bounces ? 'text-warn' : ''}>{t('admin.health.ofTotal', { n: num(h.ses.last14d.bounces), total: num(h.ses.last14d.deliveryattempts) })}</dd></div>
              <div><dt className="text-xs text-faint">{t('admin.health.complaints')}</dt><dd className={h.ses.last14d.complaints ? 'text-danger' : ''}>{num(h.ses.last14d.complaints)}</dd></div>
            </dl>
          )}
        </Panel>
      </div>
    </div>
  );
}
