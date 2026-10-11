import { Badge, DataTable, dateTime, usd, useTranslation } from '@yourapp/shared';
import type { Column } from '@yourapp/shared';
import type { Payment } from '../types';

export function PaymentState({ p }: { p: Payment }) {
  const { t } = useTranslation();
  if (p.disputed) return <Badge tone="danger">{t('admin.payments.state.disputed')}</Badge>;
  if (p.refundedCents >= p.paidCents && p.paidCents > 0) return <Badge>{t('admin.payments.state.refunded')}</Badge>;
  if (p.refundedCents > 0) return <Badge tone="warn">{t('admin.payments.state.partRefunded')}</Badge>;
  return <Badge tone="ok">{p.status === 'succeeded' ? t('admin.payments.state.paid') : p.status}</Badge>;
}

/** Payments (PAY# records): when, what, money, card, Radar risk, state. */
export default function PaymentsTable({ rows, showUser, onPick, selected }:
  { rows: Payment[]; showUser?: boolean; onPick?: (p: Payment) => void; selected?: string | null }) {
  const { t } = useTranslation();
  const columns: Column<Payment>[] = [
    { key: 'when', header: t('admin.payments.col.when'), render: (p) => <span className="whitespace-nowrap text-muted">{dateTime(p.createdAt)}</span> },
    ...(showUser ? [{ key: 'user', header: t('admin.payments.col.user'), render: (p: Payment) => <span className="font-mono text-xs">{p.userId}</span> }] : []),
    { key: 'kind', header: t('admin.payments.col.kind'), render: (p) => <span className="capitalize">{p.kind}{p.packId ? ` · ${p.packId}` : ''}</span> },
    { key: 'paid', header: t('admin.payments.col.paid'), numeric: true, render: (p) => usd(p.paidCents) },
    { key: 'fee', header: t('admin.payments.col.fee'), numeric: true, render: (p) => <span className="text-muted">{usd(p.feeCents)}</span> },
    { key: 'refunded', header: t('admin.payments.col.refunded'), numeric: true, render: (p) => (p.refundedCents ? usd(p.refundedCents) : '—') },
    { key: 'card', header: t('admin.payments.col.card'), render: (p) => <span className="whitespace-nowrap">{p.card?.brand ? `${p.card.brand} ··${p.card.last4} ${p.card.country ?? ''}` : '—'}</span> },
    { key: 'risk', header: t('admin.payments.col.risk'), render: (p) => (p.risk?.level ? <span className={p.risk.level === 'normal' ? 'text-muted' : 'text-warn'}>{p.risk.level} ({p.risk.score ?? '?'})</span> : '—') },
    { key: 'state', header: t('admin.payments.col.state'), render: (p) => <PaymentState p={p} /> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(p) => p.paymentIntent} onRowClick={onPick} selected={selected} empty={t('admin.payments.empty')} />;
}
