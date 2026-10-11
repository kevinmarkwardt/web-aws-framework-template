import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, Loading, Notice, PageHeader, Panel, Select, Stat, num, usd, useLoad } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { MoneyTotals } from '../types';

const RANGES = [7, 30, 90, 365];

export default function OverviewTab() {
  const me = useMe();
  const [days, setDays] = useState(30);
  const { data: o, error } = useLoad(() => api.overview(days), [days]);

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={`Billing mode: ${me.billingMode}. Money is in UTC days; users are all time.`}
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36 py-1.5">
            {RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </Select>
        }
      />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!o ? <Loading /> : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Users</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Accounts" value={num(o.users.total)} hint={`${num(o.users.new7)} new this week, ${num(o.users.new30)} in 30 days`} />
              <Stat label="Suspended" value={num(o.users.suspended)} tone={o.users.suspended ? 'warn' : undefined} hint="Payments paused" />
              <Stat label="Banned" value={num(o.users.banned)} tone={o.users.banned ? 'danger' : undefined} hint="Read-only" />
              <Stat label="Admins" value={num(o.users.admins)} />
            </div>
          </section>

          {o.payments && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">Money, last {o.days} days</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Revenue" value={usd(o.payments.paidCents)} hint={`${num(o.payments.count)} payments`} />
                <Stat label="Stripe fees" value={usd(o.payments.feeCents)} hint={`Net ${usd(o.payments.netCents)}`} />
                <Stat label="Refunded" value={usd(o.payments.refundedCents)} hint={o.payments.pendingRefunds ? `${o.payments.pendingRefunds} card refunds pending` : 'None pending'} />
                <Stat label="Disputes" value={num(o.payments.disputed)} tone={o.payments.disputed ? 'danger' : undefined}
                  hint={<Link to="/payments" className="text-brand-700 hover:underline">See payments</Link>} />
              </div>
              {Object.keys(o.payments.byKind).length > 0 && (
                <Panel title="By kind" className="mt-3" padded={false}>
                  <DataTable<[string, MoneyTotals]>
                    rows={Object.entries(o.payments.byKind)}
                    rowKey={([k]) => k}
                    columns={[
                      { key: 'kind', header: 'Kind', render: ([k]) => <span className="capitalize">{k}</span> },
                      { key: 'count', header: 'Payments', numeric: true, render: ([, t]) => num(t.count) },
                      { key: 'paid', header: 'Paid', numeric: true, render: ([, t]) => usd(t.paidCents) },
                      { key: 'fee', header: 'Fees', numeric: true, render: ([, t]) => usd(t.feeCents) },
                      { key: 'net', header: 'Net', numeric: true, render: ([, t]) => usd(t.netCents) },
                      { key: 'refunded', header: 'Refunded', numeric: true, render: ([, t]) => usd(t.refundedCents) },
                    ]}
                  />
                </Panel>
              )}
            </section>
          )}

          {(o.outstanding || o.subscriptions) && (
            <section className="grid gap-6 lg:grid-cols-2">
              {o.outstanding && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted">Balances users hold</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label={`Paid ${o.outstanding.creditName}`} value={num(o.outstanding.paidCredits)}
                      hint={`Up to ${usd(o.outstanding.paidCredits)} could go back to cards`} />
                    <Stat label={`Bonus ${o.outstanding.creditName}`} value={num(o.outstanding.bonusCredits)} hint="Never cash" />
                  </div>
                </div>
              )}
              {o.subscriptions && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted">Subscriptions</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Active" value={num(o.subscriptions.active)} hint={`About ${usd(o.subscriptions.mrrUsd * 100)}/month at list prices`} />
                    <Stat label="Renewal failing" value={num(o.subscriptions.failing)} tone={o.subscriptions.failing ? 'warn' : undefined} hint="In the grace period" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    {Object.entries(o.subscriptions.byPlan).map(([plan, n]) => (
                      <span key={plan} className="rounded-lg border border-line bg-panel px-2.5 py-1">
                        <span className="capitalize text-muted">{plan}</span> <span className="font-semibold tabular-nums">{num(n)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
