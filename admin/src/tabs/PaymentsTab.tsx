import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, Drawer, Loading, Notice, PageHeader, Panel, Stat, dateTime, num, usd, useLoad, useTranslation, utcToday } from '@yourapp/shared';
import { api } from '../api';
import DayNav from '../components/DayNav';
import PaymentsTable, { PaymentState } from '../components/PaymentsTable';
import { userLink } from '../session';

function PaymentDetail({ pi }: { pi: string }) {
  const { t } = useTranslation();
  const { data: p, error } = useLoad(() => api.payment(pi), [pi]);
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!p) return <Loading />;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="text-right">{value}</dd></div>
  );
  return (
    <div className="space-y-4">
      <Panel>
        <dl>
          {row(t('admin.payments.detail.paymentIntent'), <span className="font-mono text-xs">{p.paymentIntent}</span>)}
          {row(t('admin.payments.col.user'), <Link className="font-mono text-xs text-brand-700 hover:underline" to={userLink(p.userId)}>{p.userId}</Link>)}
          {row(t('admin.payments.col.when'), dateTime(p.createdAt))}
          {row(t('admin.payments.col.kind'), <span className="capitalize">{p.kind}{p.packId ? ` · ${p.packId}` : ''}{p.plan ? ` · ${p.plan}` : ''}</span>)}
          {row(t('admin.payments.col.state'), <PaymentState p={p} />)}
          {row(t('admin.payments.col.paid'), usd(p.paidCents))}
          {row(t('admin.payments.detail.stripeFeeNet'), `${usd(p.feeCents)} / ${usd(p.netCents)}`)}
          {row(t('admin.payments.col.refunded'), usd(p.refundedCents))}
          {p.credits !== undefined && row(t('admin.payments.detail.credited'), t('admin.payments.detail.creditedValue', { credits: num(p.credits), bonus: num(p.bonusCredits ?? 0) }))}
          {row(t('admin.payments.col.card'), p.card?.brand ? `${p.card.brand} ··${p.card.last4}, ${p.card.expMonth}/${p.card.expYear}, ${p.card.country ?? '?'}${p.card.funding ? `, ${p.card.funding}` : ''}` : '—')}
          {row(t('admin.payments.detail.radar'), p.risk?.level
            ? p.risk.networkStatus
              ? t('admin.payments.detail.radarValueNetwork', { level: p.risk.level, score: p.risk.score ?? '?', network: p.risk.networkStatus })
              : t('admin.payments.detail.radarValue', { level: p.risk.level, score: p.risk.score ?? '?' })
            : '—')}
          {p.receiptUrl && row(t('admin.payments.detail.receipt'), <a className="text-brand-700 hover:underline" href={p.receiptUrl} target="_blank" rel="noreferrer">{t('admin.payments.detail.openInStripe')}</a>)}
        </dl>
      </Panel>
      <Panel title={t('admin.payments.detail.refunds')} padded={false}>
        <DataTable rows={p.refunds} rowKey={(r) => r.sk} empty={t('admin.payments.detail.noRefunds')}
          columns={[
            { key: 'at', header: t('admin.payments.col.when'), render: (r) => dateTime(r.at) },
            { key: 'amount', header: t('admin.payments.col.amount'), numeric: true, render: (r) => usd(r.amountCents) },
            { key: 'status', header: t('admin.payments.col.status'), render: (r) => r.status },
            { key: 'by', header: t('admin.payments.col.by'), render: (r) => <span className="text-xs">{r.actor}</span> },
            { key: 'reason', header: t('admin.payments.col.reason'), render: (r) => <span className="text-muted">{r.reason}</span> },
          ]} />
      </Panel>
      <Panel title={t('admin.payments.detail.disputes')} padded={false}>
        <DataTable rows={p.disputes} rowKey={(r) => r.sk} empty={t('admin.payments.detail.noDisputes')}
          columns={[
            { key: 'at', header: t('admin.payments.col.opened'), render: (r) => dateTime(r.at) },
            { key: 'amount', header: t('admin.payments.col.amount'), numeric: true, render: (r) => usd(r.amountCents) },
            { key: 'reason', header: t('admin.payments.col.reason'), render: (r) => r.reason },
            { key: 'status', header: t('admin.payments.col.status'), render: (r) => r.status },
            { key: 'due', header: t('admin.payments.col.evidenceDue'), render: (r) => (r.evidenceDueBy ? dateTime(new Date(r.evidenceDueBy * 1000).toISOString()) : '—') },
          ]} />
      </Panel>
    </div>
  );
}

/** One UTC day's payments (top-ups, subscription invoices, disputed outside charges), with their detail. */
export default function PaymentsTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || utcToday();
  const selected = params.get('pi');
  const { data, error } = useLoad(() => api.payments(day), [day]);
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      if (v) p.set(k, v);
      else p.delete(k);
      return p;
    });
  return (
    <div>
      <PageHeader title={t('admin.payments.title')} subtitle={t('admin.payments.subtitle')} actions={<DayNav day={day} onChange={(d) => set('day', d)} />} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('admin.payments.col.payments')} value={num(data.totals.count)} />
            <Stat label={t('admin.payments.col.paid')} value={usd(data.totals.paidCents)} />
            <Stat label={t('admin.payments.fees')} value={usd(data.totals.feeCents)} hint={t('admin.payments.net', { amount: usd(data.totals.netCents) })} />
            <Stat label={t('admin.payments.col.refunded')} value={usd(data.totals.refundedCents)} />
          </div>
          <Panel padded={false}>
            <PaymentsTable rows={data.payments} showUser onPick={(p) => set('pi', p.paymentIntent)} selected={selected} />
          </Panel>
        </div>
      )}
      <Drawer open={!!selected} title={t('admin.payments.drawerTitle')} onClose={() => set('pi', null)}>
        {selected && <PaymentDetail key={selected} pi={selected} />}
      </Drawer>
    </div>
  );
}
