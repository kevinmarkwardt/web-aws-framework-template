import { Badge, DataTable, dateTime, usd } from '@yourapp/shared';
import type { Column } from '@yourapp/shared';
import type { Payment } from '../types';

export function PaymentState({ p }: { p: Payment }) {
  if (p.disputed) return <Badge tone="danger">Disputed</Badge>;
  if (p.refundedCents >= p.paidCents && p.paidCents > 0) return <Badge>Refunded</Badge>;
  if (p.refundedCents > 0) return <Badge tone="warn">Part refunded</Badge>;
  return <Badge tone="ok">{p.status === 'succeeded' ? 'Paid' : p.status}</Badge>;
}

/** Payments (PAY# records): when, what, money, card, Radar risk, state. */
export default function PaymentsTable({ rows, showUser, onPick, selected }:
  { rows: Payment[]; showUser?: boolean; onPick?: (p: Payment) => void; selected?: string | null }) {
  const columns: Column<Payment>[] = [
    { key: 'when', header: 'When', render: (p) => <span className="whitespace-nowrap text-muted">{dateTime(p.createdAt)}</span> },
    ...(showUser ? [{ key: 'user', header: 'User', render: (p: Payment) => <span className="font-mono text-xs">{p.userId}</span> }] : []),
    { key: 'kind', header: 'Kind', render: (p) => <span className="capitalize">{p.kind}{p.packId ? ` · ${p.packId}` : ''}</span> },
    { key: 'paid', header: 'Paid', numeric: true, render: (p) => usd(p.paidCents) },
    { key: 'fee', header: 'Fee', numeric: true, render: (p) => <span className="text-muted">{usd(p.feeCents)}</span> },
    { key: 'refunded', header: 'Refunded', numeric: true, render: (p) => (p.refundedCents ? usd(p.refundedCents) : '—') },
    { key: 'card', header: 'Card', render: (p) => <span className="whitespace-nowrap">{p.card?.brand ? `${p.card.brand} ··${p.card.last4} ${p.card.country ?? ''}` : '—'}</span> },
    { key: 'risk', header: 'Risk', render: (p) => (p.risk?.level ? <span className={p.risk.level === 'normal' ? 'text-muted' : 'text-warn'}>{p.risk.level} ({p.risk.score ?? '?'})</span> : '—') },
    { key: 'state', header: 'State', render: (p) => <PaymentState p={p} /> },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(p) => p.paymentIntent} onRowClick={onPick} selected={selected} empty="No payments." />;
}
