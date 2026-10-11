import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, DataTable, Field, Input, Loading, Notice, Panel, Select, creditsOn, dateTime, num, shortDate, subscriptionsOn, usd,
  useLoad,
} from '@yourapp/shared';
import { api } from '../api';
import PaymentsTable from '../components/PaymentsTable';
import ReasonDialog from '../components/ReasonDialog';
import { useMe } from '../session';
import type { AdminUser, UserAction, UserDetail as Detail } from '../types';

export function StatusBadge({ user }: { user: Pick<AdminUser, 'status' | 'isAdmin'> }) {
  return (
    <span className="inline-flex gap-1">
      <Badge tone={user.status === 'active' ? 'ok' : user.status === 'suspended' ? 'warn' : 'danger'}>{user.status}</Badge>
      {user.isAdmin && <Badge tone="brand">admin</Badge>}
    </span>
  );
}

interface Pending {
  action: UserAction;
  title: string;
  confirm: string;
  danger?: boolean;
  description?: string;
  extra?: Record<string, unknown>;
}

function Actions({ d, onDone }: { d: Detail; onDone: (msg: string) => void }) {
  const me = useMe();
  const u = d.user;
  const credits = creditsOn(me.billingMode);
  const self = u.userId === me.userId;
  const [pending, setPending] = useState<Pending | null>(null);
  const [days, setDays] = useState(String(d.accountRules.banDays));
  const [amount, setAmount] = useState('');
  const [policy, setPolicy] = useState<'all' | 'window'>('all');
  const unit = d.creditName ?? 'credits';
  const all = d.refundable?.all.refundable ?? 0;

  const open = (p: Pending) => {
    setAmount('');
    setPending(p);
  };
  const run = async (reason: string) => {
    if (!pending) return;
    const body: Record<string, unknown> = { reason, ...pending.extra };
    if (pending.action === 'ban') body.days = Number(days);
    if (pending.action === 'adjust-balance') body.amount = Number(amount);
    if (pending.action === 'refund-card') {
      body.amount = amount.trim() ? Number(amount) : 'max';
      body.policy = policy;
    }
    const out = await api.userAction(u.userId, pending.action, body);
    onDone(`${pending.title}: done${'refunded' in out ? `, ${usd(Number(out.refunded))} refunded` : ''}`);
  };

  const amountOk = (min: number) => amount.trim() === '' ? false : Number.isInteger(Number(amount)) && Math.abs(Number(amount)) >= min;

  return (
    <Panel title="Actions">
      <div className="flex flex-wrap gap-2">
        {u.status === 'active' && (
          <Button disabled={self} onClick={() => open({ action: 'suspend', title: 'Suspend payments', confirm: 'Suspend', danger: true,
            description: 'Payments, spending and subscription changes are refused until you lift it. Nothing is refunded.' })}>Suspend</Button>
        )}
        {u.status !== 'active' && (
          <Button onClick={() => open({ action: 'unban', title: u.status === 'banned' ? 'Unban' : 'Lift the suspension', confirm: 'Make active',
            description: 'The account goes back to active. A ban\'s refunds and forfeited bonus stay as they are.' })}>
            {u.status === 'banned' ? 'Unban' : 'Lift suspension'}
          </Button>
        )}
        {u.status !== 'banned' && (
          <Button variant="danger" disabled={self} onClick={() => open({ action: 'ban', title: `Ban ${u.email}`, confirm: 'Ban', danger: true,
            description: `Read-only for the days you choose.${credits ? ` The unused paid balance (${usd(all)}) goes back to the card and the bonus is forfeited.` : ''} An active subscription is cancelled and the cards are blocked.` })}>Ban</Button>
        )}
        <Button onClick={() => open({ action: 'warn', title: 'Add a warning', confirm: 'Warn',
          description: `Warnings expire after ${d.accountRules.warningDays} days; the ${d.accountRules.warningsToBan}th active one bans automatically. The user gets an alert and an email.` })}>Warn</Button>
        <Button disabled={self} onClick={() => open({ action: 'admin', title: u.isAdmin ? 'Remove admin' : 'Make admin', confirm: u.isAdmin ? 'Remove admin' : 'Make admin',
          danger: !u.isAdmin, extra: { isAdmin: !u.isAdmin },
          description: u.isAdmin ? 'Removes the profile flag and the Cognito group: the admin site locks them out on their next request.'
            : 'Adds the Cognito group "admins" and the profile flag. They sign in again on the admin site to use it.' })}>
          {u.isAdmin ? 'Remove admin' : 'Make admin'}
        </Button>
        {credits && (
          <>
            <Button onClick={() => open({ action: 'adjust-balance', title: 'Adjust the balance', confirm: 'Adjust',
              description: `A positive amount adds bonus ${unit} (goodwill); a negative one takes ${unit} away, bonus first. Never touches the card.` })}>Adjust balance</Button>
            <Button disabled={!all} onClick={() => open({ action: 'refund-card', title: 'Refund to the card', confirm: 'Refund', danger: true,
              description: `Unused paid ${unit} go back to the card, newest payment first (1 ${unit.replace(/s$/, '')} = 1¢). The bonus that came with them goes too.` })}>
              Refund to card ({usd(all)})
            </Button>
          </>
        )}
      </div>
      {self && <p className="mt-2 text-xs text-faint">This is you: another admin can suspend, ban or remove your admin access.</p>}

      <ReasonDialog
        open={!!pending}
        title={pending?.title}
        description={pending?.description}
        confirmLabel={pending?.confirm}
        danger={pending?.danger}
        canConfirm={pending?.action === 'adjust-balance' ? amountOk(1) && Number(amount) !== 0
          : pending?.action === 'refund-card' ? amount.trim() === '' || (amountOk(1) && Number(amount) > 0)
          : pending?.action === 'ban' ? Number(days) >= 1 && Number(days) <= 3650 : true}
        onClose={() => setPending(null)}
        onConfirm={run}
      >
        {pending?.action === 'ban' && (
          <Field label="Days" hint="1 to 3650">
            <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
        {pending?.action === 'adjust-balance' && (
          <Field label={`Amount (${unit})`} hint="e.g. 500 to give, -200 to take away">
            <Input type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {pending?.action === 'refund-card' && (
          <>
            <Field label={`Amount (paid ${unit})`} hint={`Empty refunds everything refundable (${num(all)}).`}>
              <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(all)} />
            </Field>
            <Field label="Policy">
              <Select value={policy} onChange={(e) => setPolicy(e.target.value as 'all' | 'window')}>
                <option value="all">Any unused paid {unit} (admin)</option>
                <option value="window">The customer's own rules ({num(d.refundable?.window.refundable ?? 0)} now)</option>
              </Select>
            </Field>
          </>
        )}
      </ReasonDialog>
    </Panel>
  );
}

function Warnings({ d, onDone }: { d: Detail; onDone: (msg: string) => void }) {
  const [sk, setSk] = useState<string | null>(null);
  const active = d.warnings.filter((w) => w.active).length;
  return (
    <Panel title={`Warnings (${active} active of ${d.accountRules.warningsToBan} to a ban)`}>
      {!d.warnings.length ? <p className="text-sm text-faint">None.</p> : (
        <ul className="divide-y divide-line text-sm">
          {d.warnings.map((w) => (
            <li key={w.sk} className="flex items-start gap-3 py-2">
              <div className="flex-1">
                <p className={w.active ? 'text-ink' : 'text-faint line-through'}>{w.reason}</p>
                <p className="text-xs text-faint">{dateTime(w.at)} by {w.actor} · {w.removed ? `removed by ${w.removedBy}` : `expires ${shortDate(w.expiresAt)}`}</p>
              </div>
              {w.active && <Button size="sm" onClick={() => setSk(w.sk)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog open={!!sk} title="Remove this warning" confirmLabel="Remove" onClose={() => setSk(null)}
        description="It stops counting. A ban it already caused stays until you unban."
        onConfirm={async (reason) => {
          await api.userAction(d.user.userId, 'remove-warning', { reason, warningSk: sk });
          onDone('Warning removed');
        }} />
    </Panel>
  );
}

export default function UserDetail({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const me = useMe();
  const { data: d, error, reload } = useLoad(() => api.user(userId), [userId]);
  const [msg, setMsg] = useState('');
  if (error && !d) return <Notice tone="danger">{error}</Notice>;
  if (!d) return <Loading />;
  const u = d.user;
  const done = (m: string) => {
    setMsg(m);
    reload();
    onChanged();
  };
  const unit = d.creditName ?? 'credits';
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold text-ink">{u.name || u.email}</div>
            <div className="text-sm text-muted">{u.email}</div>
            <div className="mt-1 font-mono text-xs text-faint">{u.userId}</div>
          </div>
          <StatusBadge user={u} />
        </div>
        {u.statusReason && <p className="mt-2 text-sm text-muted">Reason: {u.statusReason}{u.bannedUntil ? ` · until ${shortDate(u.bannedUntil)}` : ''}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-faint">Joined</dt><dd>{shortDate(u.createdAt)}</dd></div>
          <div><dt className="text-xs text-faint">Items</dt><dd className="tabular-nums">{num(u.itemCount)}</dd></div>
          {subscriptionsOn(me.billingMode) && <div><dt className="text-xs text-faint">Plan</dt><dd className="capitalize">{u.plan}</dd></div>}
          {creditsOn(me.billingMode) && (
            <div><dt className="text-xs text-faint">Balance</dt><dd className="tabular-nums">{num(u.credits ?? 0)} <span className="text-xs text-faint">({num(u.paidCredits ?? 0)} paid · {num(u.bonusCredits ?? 0)} bonus)</span></dd></div>
          )}
        </dl>
        {u.stripeCustomerId && <p className="mt-3 text-xs text-faint">Stripe customer {u.stripeCustomerId} · {u.cards} card{u.cards === 1 ? '' : 's'} used</p>}
      </Panel>

      {msg && <Notice tone="ok">{msg}</Notice>}
      <Actions d={d} onDone={done} />
      <Warnings d={d} onDone={done} />

      {d.subscription && (
        <Panel title="Subscription">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-faint">Plan</dt><dd className="capitalize">{d.subscription.plan}</dd></div>
            <div><dt className="text-xs text-faint">In effect</dt><dd className="capitalize">{d.subscription.effectivePlan}</dd></div>
            <div><dt className="text-xs text-faint">Stripe status</dt><dd>{d.subscription.subscriptionStatus ?? '—'}</dd></div>
            <div><dt className="text-xs text-faint">Renewal failed</dt><dd>{d.subscription.paymentFailedAt ? `${shortDate(d.subscription.paymentFailedAt)} (grace to ${shortDate(d.subscription.graceUntil)})` : '—'}</dd></div>
          </dl>
        </Panel>
      )}

      {d.payments && (
        <Panel title="Payments" padded={false}>
          <PaymentsTable rows={d.payments} />
        </Panel>
      )}

      {d.history && (
        <Panel title={`Balance history (${unit})`} padded={false}>
          <DataTable
            rows={d.history}
            rowKey={(t) => `${t.at}-${t.kind}-${t.amount}`}
            empty="No balance activity."
            columns={[
              { key: 'at', header: 'When', render: (t) => <span className="whitespace-nowrap text-muted">{dateTime(t.at)}</span> },
              { key: 'kind', header: 'Kind', render: (t) => t.kind },
              { key: 'amount', header: 'Amount', numeric: true, render: (t) => <span className={t.amount < 0 ? 'text-danger' : 'text-ok'}>{t.amount > 0 ? '+' : ''}{num(t.amount)}</span> },
              { key: 'split', header: 'Paid / bonus', numeric: true, render: (t) => <span className="text-faint">{num(t.paid)} / {num(t.bonus)}</span> },
              { key: 'after', header: 'Balance', numeric: true, render: (t) => num(t.balanceAfter) },
              { key: 'note', header: 'Note', render: (t) => <span className="text-muted">{t.note}</span> },
            ]}
          />
        </Panel>
      )}

      {!!d.pending?.length && (
        <Panel title="Rewards on hold">
          <ul className="text-sm">{d.pending.map((h) => <li key={h.sk}>{num(h.amount)} {unit} · {h.kind} · releases {shortDate(h.releaseAt)}</li>)}</ul>
        </Panel>
      )}

      <Panel title="Account alerts they can see">
        {!d.notes.length ? <p className="text-sm text-faint">None.</p> : (
          <ul className="divide-y divide-line text-sm">
            {d.notes.map((n) => (
              <li key={n.id} className="py-2"><span className="font-medium">{n.title}</span> <span className="text-xs text-faint">{dateTime(n.createdAt)}</span><p className="text-muted">{n.message}</p></li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-faint">
        Their actions in the <Link className="text-brand-700 hover:underline" to={`/audit?target=${encodeURIComponent(`user:${u.userId}`)}`}>audit log</Link>
        {me.billingMode !== 'none' && <> and <Link className="text-brand-700 hover:underline" to={`/stripe-log?user=${encodeURIComponent(u.userId)}`}>Stripe log</Link></>} (today; pick another day there).
      </p>
    </div>
  );
}
