import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, Loading, Notice, PageHeader, Panel, Select, Stat, num, usd, useLoad, useTranslation } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { MoneyTotals } from '../types';

const RANGES = [7, 30, 90, 365];

export default function OverviewTab() {
  const { t } = useTranslation();
  const me = useMe();
  const [days, setDays] = useState(30);
  const { data: o, error } = useLoad(() => api.overview(days), [days]);

  return (
    <div>
      <PageHeader
        title={t('admin.overview.title')}
        subtitle={t('admin.overview.subtitle', { mode: me.billingMode })}
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36 py-1.5">
            {RANGES.map((d) => <option key={d} value={d}>{t('admin.overview.lastDays', { days: d })}</option>)}
          </Select>
        }
      />
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!o ? <Loading /> : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">{t('admin.overview.users')}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('admin.overview.accounts')} value={num(o.users.total)} hint={t('admin.overview.accountsHint', { new7: num(o.users.new7), new30: num(o.users.new30) })} />
              <Stat label={t('admin.overview.suspended')} value={num(o.users.suspended)} tone={o.users.suspended ? 'warn' : undefined} hint={t('admin.overview.suspendedHint')} />
              <Stat label={t('admin.overview.banned')} value={num(o.users.banned)} tone={o.users.banned ? 'danger' : undefined} hint={t('admin.overview.bannedHint')} />
              <Stat label={t('admin.overview.admins')} value={num(o.users.admins)} />
            </div>
          </section>

          {o.payments && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted">{t('admin.overview.money', { days: o.days })}</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label={t('admin.overview.revenue')} value={usd(o.payments.paidCents)} hint={t('admin.overview.revenueHint', { payments: num(o.payments.count) })} />
                <Stat label={t('admin.overview.stripeFees')} value={usd(o.payments.feeCents)} hint={t('admin.overview.net', { amount: usd(o.payments.netCents) })} />
                <Stat label={t('admin.overview.refunded')} value={usd(o.payments.refundedCents)} hint={o.payments.pendingRefunds ? t('admin.overview.refundsPending', { refunds: o.payments.pendingRefunds }) : t('admin.overview.nonePending')} />
                <Stat label={t('admin.overview.disputes')} value={num(o.payments.disputed)} tone={o.payments.disputed ? 'danger' : undefined}
                  hint={<Link to="/payments" className="text-brand-700 hover:underline">{t('admin.overview.seePayments')}</Link>} />
              </div>
              {Object.keys(o.payments.byKind).length > 0 && (
                <Panel title={t('admin.overview.byKind')} className="mt-3" padded={false}>
                  <DataTable<[string, MoneyTotals]>
                    rows={Object.entries(o.payments.byKind)}
                    rowKey={([k]) => k}
                    columns={[
                      { key: 'kind', header: t('admin.overview.kind'), render: ([k]) => <span className="capitalize">{k}</span> },
                      { key: 'count', header: t('admin.overview.payments'), numeric: true, render: ([, t]) => num(t.count) },
                      { key: 'paid', header: t('admin.overview.paid'), numeric: true, render: ([, t]) => usd(t.paidCents) },
                      { key: 'fee', header: t('admin.overview.fees'), numeric: true, render: ([, t]) => usd(t.feeCents) },
                      { key: 'net', header: t('admin.overview.netColumn'), numeric: true, render: ([, t]) => usd(t.netCents) },
                      { key: 'refunded', header: t('admin.overview.refunded'), numeric: true, render: ([, t]) => usd(t.refundedCents) },
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
                  <h2 className="mb-3 text-sm font-semibold text-muted">{t('admin.overview.balances')}</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label={t('admin.overview.paidCredits', { name: o.outstanding.creditName })} value={num(o.outstanding.paidCredits)}
                      hint={t('admin.overview.paidCreditsHint', { amount: usd(o.outstanding.paidCredits) })} />
                    <Stat label={t('admin.overview.bonusCredits', { name: o.outstanding.creditName })} value={num(o.outstanding.bonusCredits)} hint={t('admin.overview.neverCash')} />
                  </div>
                </div>
              )}
              {o.subscriptions && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted">{t('admin.overview.subscriptions')}</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label={t('admin.overview.active')} value={num(o.subscriptions.active)} hint={t('admin.overview.activeHint', { amount: usd(o.subscriptions.mrrUsd * 100) })} />
                    <Stat label={t('admin.overview.renewalFailing')} value={num(o.subscriptions.failing)} tone={o.subscriptions.failing ? 'warn' : undefined} hint={t('admin.overview.renewalFailingHint')} />
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
