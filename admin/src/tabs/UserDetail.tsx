import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, DataTable, Field, Input, Loading, Notice, Panel, Select, Trans, creditsOn, dateTime, num, shortDate, subscriptionsOn, usd,
  useLoad, useTranslation,
} from '@yourapp/shared';
import { api } from '../api';
import PaymentsTable from '../components/PaymentsTable';
import ReasonDialog from '../components/ReasonDialog';
import { useMe } from '../session';
import type { AdminUser, UserAction, UserDetail as Detail } from '../types';

const STATUS_KEYS: Record<string, string> = {
  active: 'adminUsers.status.active',
  suspended: 'adminUsers.status.suspended',
  banned: 'adminUsers.status.banned',
};

export function StatusBadge({ user }: { user: Pick<AdminUser, 'status' | 'isAdmin'> }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex gap-1">
      <Badge tone={user.status === 'active' ? 'ok' : user.status === 'suspended' ? 'warn' : 'danger'}>{STATUS_KEYS[user.status] ? t(STATUS_KEYS[user.status]) : user.status}</Badge>
      {user.isAdmin && <Badge tone="brand">{t('adminUsers.status.admin')}</Badge>}
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
  const { t } = useTranslation();
  const me = useMe();
  const u = d.user;
  const credits = creditsOn(me.billingMode);
  const self = u.userId === me.userId;
  const [pending, setPending] = useState<Pending | null>(null);
  const [days, setDays] = useState(String(d.accountRules.banDays));
  const [amount, setAmount] = useState('');
  const [policy, setPolicy] = useState<'all' | 'window'>('all');
  const unit = d.creditName ?? t('adminUsers.detail.creditsUnit');
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
    onDone('refunded' in out
      ? t('adminUsers.actions.doneRefunded', { title: pending.title, amount: usd(Number(out.refunded)) })
      : t('adminUsers.actions.done', { title: pending.title }));
  };

  const amountOk = (min: number) => amount.trim() === '' ? false : Number.isInteger(Number(amount)) && Math.abs(Number(amount)) >= min;

  return (
    <Panel title={t('adminUsers.actions.title')}>
      <div className="flex flex-wrap gap-2">
        {u.status === 'active' && (
          <Button disabled={self} onClick={() => open({ action: 'suspend', title: t('adminUsers.actions.suspendTitle'), confirm: t('adminUsers.actions.suspend'), danger: true,
            description: t('adminUsers.actions.suspendDescription') })}>{t('adminUsers.actions.suspend')}</Button>
        )}
        {u.status !== 'active' && (
          <Button onClick={() => open({ action: 'unban', title: u.status === 'banned' ? t('adminUsers.actions.unban') : t('adminUsers.actions.liftTitle'), confirm: t('adminUsers.actions.makeActive'),
            description: t('adminUsers.actions.unbanDescription') })}>
            {u.status === 'banned' ? t('adminUsers.actions.unban') : t('adminUsers.actions.lift')}
          </Button>
        )}
        {u.status !== 'banned' && (
          <Button variant="danger" disabled={self} onClick={() => open({ action: 'ban', title: t('adminUsers.actions.banTitle', { email: u.email }), confirm: t('adminUsers.actions.ban'), danger: true,
            description: credits ? t('adminUsers.actions.banDescriptionCredits', { amount: usd(all) }) : t('adminUsers.actions.banDescription') })}>{t('adminUsers.actions.ban')}</Button>
        )}
        <Button onClick={() => open({ action: 'warn', title: t('adminUsers.actions.warnTitle'), confirm: t('adminUsers.actions.warn'),
          description: t('adminUsers.actions.warnDescription', { days: d.accountRules.warningDays, toBan: d.accountRules.warningsToBan }) })}>{t('adminUsers.actions.warn')}</Button>
        <Button disabled={self} onClick={() => open({ action: 'admin', title: u.isAdmin ? t('adminUsers.actions.removeAdmin') : t('adminUsers.actions.makeAdmin'), confirm: u.isAdmin ? t('adminUsers.actions.removeAdmin') : t('adminUsers.actions.makeAdmin'),
          danger: !u.isAdmin, extra: { isAdmin: !u.isAdmin },
          description: u.isAdmin ? t('adminUsers.actions.removeAdminDescription')
            : t('adminUsers.actions.makeAdminDescription') })}>
          {u.isAdmin ? t('adminUsers.actions.removeAdmin') : t('adminUsers.actions.makeAdmin')}
        </Button>
        {credits && (
          <>
            <Button onClick={() => open({ action: 'adjust-balance', title: t('adminUsers.actions.adjustTitle'), confirm: t('adminUsers.actions.adjust'),
              description: t('adminUsers.actions.adjustDescription', { unit }) })}>{t('adminUsers.actions.adjustBalance')}</Button>
            <Button disabled={!all} onClick={() => open({ action: 'refund-card', title: t('adminUsers.actions.refundTitle'), confirm: t('adminUsers.actions.refund'), danger: true,
              description: t('adminUsers.actions.refundDescription', { unit, one: unit.replace(/s$/, '') }) })}>
              {t('adminUsers.actions.refundToCard', { amount: usd(all) })}
            </Button>
          </>
        )}
      </div>
      {self && <p className="mt-2 text-xs text-faint">{t('adminUsers.actions.selfNote')}</p>}

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
          <Field label={t('adminUsers.actions.days')} hint={t('adminUsers.actions.daysHint')}>
            <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
        {pending?.action === 'adjust-balance' && (
          <Field label={t('adminUsers.actions.amount', { unit })} hint={t('adminUsers.actions.amountHint')}>
            <Input type="number" step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {pending?.action === 'refund-card' && (
          <>
            <Field label={t('adminUsers.actions.refundAmount', { unit })} hint={t('adminUsers.actions.refundAmountHint', { amount: num(all) })}>
              <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(all)} />
            </Field>
            <Field label={t('adminUsers.actions.policy')}>
              <Select value={policy} onChange={(e) => setPolicy(e.target.value as 'all' | 'window')}>
                <option value="all">{t('adminUsers.actions.policyAll', { unit })}</option>
                <option value="window">{t('adminUsers.actions.policyWindow', { amount: num(d.refundable?.window.refundable ?? 0) })}</option>
              </Select>
            </Field>
          </>
        )}
      </ReasonDialog>
    </Panel>
  );
}

function Warnings({ d, onDone }: { d: Detail; onDone: (msg: string) => void }) {
  const { t } = useTranslation();
  const [sk, setSk] = useState<string | null>(null);
  const active = d.warnings.filter((w) => w.active).length;
  return (
    <Panel title={t('adminUsers.warnings.title', { active, toBan: d.accountRules.warningsToBan })}>
      {!d.warnings.length ? <p className="text-sm text-faint">{t('adminUsers.warnings.none')}</p> : (
        <ul className="divide-y divide-line text-sm">
          {d.warnings.map((w) => (
            <li key={w.sk} className="flex items-start gap-3 py-2">
              <div className="flex-1">
                <p className={w.active ? 'text-ink' : 'text-faint line-through'}>{w.reason}</p>
                <p className="text-xs text-faint">{t('adminUsers.warnings.by', { at: dateTime(w.at), actor: w.actor })} · {w.removed ? t('adminUsers.warnings.removedBy', { actor: w.removedBy }) : t('adminUsers.warnings.expires', { date: shortDate(w.expiresAt) })}</p>
              </div>
              {w.active && <Button size="sm" onClick={() => setSk(w.sk)}>{t('adminUsers.warnings.remove')}</Button>}
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog open={!!sk} title={t('adminUsers.warnings.removeTitle')} confirmLabel={t('adminUsers.warnings.remove')} onClose={() => setSk(null)}
        description={t('adminUsers.warnings.removeDescription')}
        onConfirm={async (reason) => {
          await api.userAction(d.user.userId, 'remove-warning', { reason, warningSk: sk });
          onDone(t('adminUsers.warnings.removed'));
        }} />
    </Panel>
  );
}

export default function UserDetail({ userId, onChanged }: { userId: string; onChanged: () => void }) {
  const { t } = useTranslation();
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
  const unit = d.creditName ?? t('adminUsers.detail.creditsUnit');
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
        {u.statusReason && <p className="mt-2 text-sm text-muted">{t('adminUsers.detail.reason', { reason: u.statusReason })}{u.bannedUntil ? ` · ${t('adminUsers.detail.until', { date: shortDate(u.bannedUntil) })}` : ''}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-faint">{t('adminUsers.detail.joined')}</dt><dd>{shortDate(u.createdAt)}</dd></div>
          <div><dt className="text-xs text-faint">{t('adminUsers.detail.items')}</dt><dd className="tabular-nums">{num(u.itemCount)}</dd></div>
          {subscriptionsOn(me.billingMode) && <div><dt className="text-xs text-faint">{t('adminUsers.detail.plan')}</dt><dd className="capitalize">{u.plan}</dd></div>}
          {creditsOn(me.billingMode) && (
            <div><dt className="text-xs text-faint">{t('adminUsers.detail.balance')}</dt><dd className="tabular-nums">{num(u.credits ?? 0)} <span className="text-xs text-faint">{t('adminUsers.detail.balanceSplit', { paid: num(u.paidCredits ?? 0), bonus: num(u.bonusCredits ?? 0) })}</span></dd></div>
          )}
        </dl>
        {u.stripeCustomerId && <p className="mt-3 text-xs text-faint">{t('adminUsers.detail.stripeCustomer', { id: u.stripeCustomerId, count: u.cards })}</p>}
      </Panel>

      {msg && <Notice tone="ok">{msg}</Notice>}
      <Actions d={d} onDone={done} />
      <Warnings d={d} onDone={done} />

      {d.subscription && (
        <Panel title={t('adminUsers.detail.subscription')}>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-faint">{t('adminUsers.detail.plan')}</dt><dd className="capitalize">{d.subscription.plan}</dd></div>
            <div><dt className="text-xs text-faint">{t('adminUsers.detail.inEffect')}</dt><dd className="capitalize">{d.subscription.effectivePlan}</dd></div>
            <div><dt className="text-xs text-faint">{t('adminUsers.detail.stripeStatus')}</dt><dd>{d.subscription.subscriptionStatus ?? '—'}</dd></div>
            <div><dt className="text-xs text-faint">{t('adminUsers.detail.renewalFailed')}</dt><dd>{d.subscription.paymentFailedAt ? t('adminUsers.detail.grace', { date: shortDate(d.subscription.paymentFailedAt), grace: shortDate(d.subscription.graceUntil) }) : '—'}</dd></div>
          </dl>
        </Panel>
      )}

      {d.payments && (
        <Panel title={t('adminUsers.detail.payments')} padded={false}>
          <PaymentsTable rows={d.payments} />
        </Panel>
      )}

      {d.history && (
        <Panel title={t('adminUsers.detail.history', { unit })} padded={false}>
          <DataTable
            rows={d.history}
            rowKey={(t) => `${t.at}-${t.kind}-${t.amount}`}
            empty={t('adminUsers.detail.historyEmpty')}
            columns={[
              { key: 'at', header: t('adminUsers.detail.colWhen'), render: (t) => <span className="whitespace-nowrap text-muted">{dateTime(t.at)}</span> },
              { key: 'kind', header: t('adminUsers.detail.colKind'), render: (t) => t.kind },
              { key: 'amount', header: t('adminUsers.detail.colAmount'), numeric: true, render: (t) => <span className={t.amount < 0 ? 'text-danger' : 'text-ok'}>{t.amount > 0 ? '+' : ''}{num(t.amount)}</span> },
              { key: 'split', header: t('adminUsers.detail.colSplit'), numeric: true, render: (t) => <span className="text-faint">{num(t.paid)} / {num(t.bonus)}</span> },
              { key: 'after', header: t('adminUsers.detail.colBalance'), numeric: true, render: (t) => num(t.balanceAfter) },
              { key: 'note', header: t('adminUsers.detail.colNote'), render: (t) => <span className="text-muted">{t.note}</span> },
            ]}
          />
        </Panel>
      )}

      {!!d.pending?.length && (
        <Panel title={t('adminUsers.detail.onHold')}>
          <ul className="text-sm">{d.pending.map((h) => <li key={h.sk}>{t('adminUsers.detail.onHoldRow', { amount: num(h.amount), unit, kind: h.kind, date: shortDate(h.releaseAt) })}</li>)}</ul>
        </Panel>
      )}

      <Panel title={t('adminUsers.detail.alerts')}>
        {!d.notes.length ? <p className="text-sm text-faint">{t('adminUsers.detail.none')}</p> : (
          <ul className="divide-y divide-line text-sm">
            {d.notes.map((n) => (
              <li key={n.id} className="py-2"><span className="font-medium">{n.title}</span> <span className="text-xs text-faint">{dateTime(n.createdAt)}</span><p className="text-muted">{n.message}</p></li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-faint">
        <Trans
          i18nKey={me.billingMode !== 'none' ? 'adminUsers.detail.logsStripe' : 'adminUsers.detail.logs'}
          components={{
            audit: <Link className="text-brand-700 hover:underline" to={`/audit?target=${encodeURIComponent(`user:${u.userId}`)}`} />,
            stripe: <Link className="text-brand-700 hover:underline" to={`/stripe-log?user=${encodeURIComponent(u.userId)}`} />,
          }}
        />
      </p>
    </div>
  );
}
