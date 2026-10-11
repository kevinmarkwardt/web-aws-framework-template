import { Link, useSearchParams } from 'react-router-dom';
import { DataTable, Drawer, Loading, Notice, PageHeader, Panel, Stat, dateTime, num, usd, useLoad, utcToday } from '@yourapp/shared';
import { api } from '../api';
import DayNav from '../components/DayNav';
import PaymentsTable, { PaymentState } from '../components/PaymentsTable';
import { userLink } from '../session';

function PaymentDetail({ pi }: { pi: string }) {
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
          {row('Payment intent', <span className="font-mono text-xs">{p.paymentIntent}</span>)}
          {row('User', <Link className="font-mono text-xs text-brand-700 hover:underline" to={userLink(p.userId)}>{p.userId}</Link>)}
          {row('When', dateTime(p.createdAt))}
          {row('Kind', <span className="capitalize">{p.kind}{p.packId ? ` · ${p.packId}` : ''}{p.plan ? ` · ${p.plan}` : ''}</span>)}
          {row('State', <PaymentState p={p} />)}
          {row('Paid', usd(p.paidCents))}
          {row('Stripe fee / net', `${usd(p.feeCents)} / ${usd(p.netCents)}`)}
          {row('Refunded', usd(p.refundedCents))}
          {p.credits !== undefined && row('Credited', `${num(p.credits)} (${num(p.bonusCredits ?? 0)} bonus)`)}
          {row('Card', p.card?.brand ? `${p.card.brand} ··${p.card.last4}, ${p.card.expMonth}/${p.card.expYear}, ${p.card.country ?? '?'}${p.card.funding ? `, ${p.card.funding}` : ''}` : '—')}
          {row('Radar', p.risk?.level ? `${p.risk.level} (score ${p.risk.score ?? '?'}${p.risk.networkStatus ? `, ${p.risk.networkStatus}` : ''})` : '—')}
          {p.receiptUrl && row('Receipt', <a className="text-brand-700 hover:underline" href={p.receiptUrl} target="_blank" rel="noreferrer">Open in Stripe</a>)}
        </dl>
      </Panel>
      <Panel title="Refunds" padded={false}>
        <DataTable rows={p.refunds} rowKey={(r) => r.sk} empty="No refunds."
          columns={[
            { key: 'at', header: 'When', render: (r) => dateTime(r.at) },
            { key: 'amount', header: 'Amount', numeric: true, render: (r) => usd(r.amountCents) },
            { key: 'status', header: 'Status', render: (r) => r.status },
            { key: 'by', header: 'By', render: (r) => <span className="text-xs">{r.actor}</span> },
            { key: 'reason', header: 'Reason', render: (r) => <span className="text-muted">{r.reason}</span> },
          ]} />
      </Panel>
      <Panel title="Disputes" padded={false}>
        <DataTable rows={p.disputes} rowKey={(r) => r.sk} empty="No disputes."
          columns={[
            { key: 'at', header: 'Opened', render: (r) => dateTime(r.at) },
            { key: 'amount', header: 'Amount', numeric: true, render: (r) => usd(r.amountCents) },
            { key: 'reason', header: 'Reason', render: (r) => r.reason },
            { key: 'status', header: 'Status', render: (r) => r.status },
            { key: 'due', header: 'Evidence due', render: (r) => (r.evidenceDueBy ? dateTime(new Date(r.evidenceDueBy * 1000).toISOString()) : '—') },
          ]} />
      </Panel>
    </div>
  );
}

/** One UTC day's payments (top-ups, subscription invoices, disputed outside charges), with their detail. */
export default function PaymentsTab() {
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
      <PageHeader title="Payments" subtitle="Every payment recorded from Stripe, by UTC day." actions={<DayNav day={day} onChange={(d) => set('day', d)} />} />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!data ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Payments" value={num(data.totals.count)} />
            <Stat label="Paid" value={usd(data.totals.paidCents)} />
            <Stat label="Fees" value={usd(data.totals.feeCents)} hint={`Net ${usd(data.totals.netCents)}`} />
            <Stat label="Refunded" value={usd(data.totals.refundedCents)} />
          </div>
          <Panel padded={false}>
            <PaymentsTable rows={data.payments} showUser onPick={(p) => set('pi', p.paymentIntent)} selected={selected} />
          </Panel>
        </div>
      )}
      <Drawer open={!!selected} title="Payment" onClose={() => set('pi', null)}>
        {selected && <PaymentDetail key={selected} pi={selected} />}
      </Drawer>
    </div>
  );
}
