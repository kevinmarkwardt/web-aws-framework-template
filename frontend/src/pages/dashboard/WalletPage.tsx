import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuthContext } from '../../auth-context';
import {
  ApiError, cardRemovalCheck, chargeWallet, fetchCards, fetchRefundOptions, fetchWallet, finishCharge, makeDefaultCard,
  removeCard, requestRefund, saveAutoReload, setupCard,
} from '../../api';
import { shortDate, units, usd } from '../../billing';
import type { RefundRow, SavedCard, Wallet } from '../../types';

// Functional wallet (plain styling; the design pass comes later). Rules live in the API: api/lib/credits.py,
// api/lib/payments.py, docs/payments.md.

const card = 'bg-white rounded-xl border border-gray-200 p-6 mb-6';
const btn = 'px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50';
const btnLight = 'px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-lg disabled:opacity-50';

const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function WalletPage() {
  const { refresh } = useContext(AuthContext);
  const [params, setParams] = useSearchParams();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [customUsd, setCustomUsd] = useState('');
  const [cardId, setCardId] = useState('');
  // One request id per purchase attempt: resent unchanged while the outcome is unknown, so Stripe charges once.
  const requestId = useRef(newRequestId());

  const load = useCallback(async () => {
    try {
      const [w, c] = await Promise.all([fetchWallet(), fetchCards().catch(() => ({ cards: [] as SavedCard[] }))]);
      setWallet(w);
      setCards(c.cards);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Back from a bank's 3-D Secure page, or from adding a card on Stripe's page
  useEffect(() => {
    const pi = params.get('payment_intent');
    const added = params.get('card');
    if (!pi && !added) return;
    setParams({}, { replace: true });
    if (added === 'added') setMessage({ kind: 'ok', text: 'Card added.' });
    if (pi) {
      finishCharge(pi)
        .then((r) => {
          setMessage(r.status === 'succeeded' ? { kind: 'ok', text: 'Payment complete.' } : { kind: 'ok', text: 'Your payment is still processing.' });
          load();
          refresh();
        })
        .catch((e) => setMessage({ kind: 'error', text: (e as Error).message }));
    }
  }, [params, setParams, load, refresh]);

  if (!wallet) {
    return message ? <p className="text-red-700">{message.text}</p> : <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />;
  }
  const name = wallet.creditName;
  const restricted = wallet.status !== 'active';
  const defaultCard = cards.find((c) => c.isDefault);

  const buy = async (args: { packId?: string; customUsd?: number }) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await chargeWallet({ ...args, paymentMethodId: cardId || undefined, requestId: requestId.current });
      if (r.status === 'requires_action' && r.redirectUrl) {
        window.location.href = r.redirectUrl; // the bank's check; we come back with ?payment_intent=
        return;
      }
      requestId.current = newRequestId();
      setMessage({ kind: 'ok', text: r.status === 'succeeded' ? 'Payment complete.' : 'Your payment is processing; it arrives as soon as it clears.' });
      await load();
      await refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.outcome === 'unknown')) requestId.current = newRequestId(); // nothing was charged
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const addCard = async () => {
    try {
      window.location.href = (await setupCard('wallet')).url;
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const customValue = Number(customUsd);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        {wallet.testMode && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Test mode</span>}
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${message.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <section className={card}>
        <p className="text-sm text-gray-500">Balance</p>
        <p className="text-3xl font-bold text-gray-900">{units(wallet.credits, name)}</p>
        <p className="text-sm text-gray-600 mt-1">
          {units(wallet.paidCredits, name)} bought, {units(wallet.bonusCredits, name)} bonus. {wallet.perDollar} {name} = $1.
          Bought {name} are used first.
        </p>
        {wallet.pendingCredits > 0 && (
          <p className="text-sm text-gray-600 mt-1">{units(wallet.pendingCredits, name)} on hold, released {shortDate(wallet.pending[0]?.releaseAt)}.</p>
        )}
        {Object.keys(wallet.creditCosts).length > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Costs: {Object.entries(wallet.creditCosts).map(([k, v]) => `${k.replace(/_/g, ' ')} ${units(v, name)}`).join(', ')}
          </p>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Add {name}</h2>
        {!wallet.canPay && <p className="text-sm text-amber-800 mb-3">Payments aren't available in your country yet.</p>}
        {restricted && <p className="text-sm text-amber-800 mb-3">Payments are paused on this account.</p>}
        {cards.length === 0 ? (
          <div>
            <p className="text-sm text-gray-600 mb-3">Add a card to buy {name}. Your card details stay with Stripe.</p>
            <button className={btn} onClick={addCard} disabled={!wallet.canPay || restricted}>Add a card</button>
          </div>
        ) : (
          <>
            <label className="block text-sm text-gray-700 mb-3">
              Pay with{' '}
              <select className="border border-gray-300 rounded-lg px-2 py-1" value={cardId || defaultCard?.id || ''} onChange={(e) => setCardId(e.target.value)}>
                {cards.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.accepted}>
                    {c.brand} •••• {c.last4}{c.isDefault ? ' (default)' : ''}{c.accepted ? '' : ' (not accepted)'}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {wallet.packs.map((p) => (
                <button key={p.id} className="border border-gray-200 rounded-lg p-3 text-left hover:border-indigo-400 disabled:opacity-50"
                  disabled={busy || !wallet.canPay || restricted} onClick={() => buy({ packId: p.id })}>
                  <span className="block font-semibold text-gray-900">{usd(p.payCents)}</span>
                  <span className="block text-sm text-gray-600">{units(p.credits, name)}</span>
                  {p.bonus > 0 && <span className="block text-xs text-green-700">+{p.bonus.toLocaleString()} bonus</span>}
                  {wallet.localCurrency && (
                    <span className="block text-xs text-gray-400">
                      ≈ {(p.payCents / 100 * Number(wallet.localCurrency.perUsd)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {wallet.localCurrency.currency}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {wallet.custom && (
              <div className="flex items-center gap-2 mt-4">
                <span className="text-sm text-gray-700">Other amount: $</span>
                <input type="number" min={wallet.custom.minUsd} max={wallet.custom.maxUsd} step={1} value={customUsd}
                  onChange={(e) => setCustomUsd(e.target.value)} className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                <button className={btnLight} disabled={busy || !wallet.canPay || restricted || !Number.isInteger(customValue)
                  || customValue < wallet.custom.minUsd || customValue > wallet.custom.maxUsd}
                  onClick={() => buy({ customUsd: customValue })}>
                  Buy
                </button>
                <span className="text-xs text-gray-500">${wallet.custom.minUsd}–${wallet.custom.maxUsd}, no bonus</span>
              </div>
            )}
          </>
        )}
      </section>

      <CardsSection cards={cards} setCards={setCards} onAdd={addCard} canAdd={wallet.canPay && !restricted} setMessage={setMessage} />
      {cards.length > 0 && <AutoReloadSection wallet={wallet} onSaved={load} setMessage={setMessage} />}
      <RefundSection wallet={wallet} onDone={async () => { await load(); await refresh(); }} setMessage={setMessage} />

      <section className={card}>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">History</h2>
        {wallet.transactions.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500"><th className="py-1">Date</th><th>What</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr>
            </thead>
            <tbody>
              {wallet.transactions.map((t, i) => (
                <tr key={`${t.at}-${i}`} className="border-t border-gray-100">
                  <td className="py-1 text-gray-500">{shortDate(t.at)}</td>
                  <td className="text-gray-800">{t.note}</td>
                  <td className={`text-right ${t.amount < 0 ? 'text-gray-700' : 'text-green-700'}`}>{t.amount > 0 ? '+' : ''}{t.amount.toLocaleString()}</td>
                  <td className="text-right text-gray-500">{t.balanceAfter.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

type SetMessage = (m: { kind: 'ok' | 'error'; text: string } | null) => void;

function CardsSection({ cards, setCards, onAdd, canAdd, setMessage }: {
  cards: SavedCard[]; setCards: (c: SavedCard[]) => void; onAdd: () => void; canAdd: boolean; setMessage: SetMessage;
}) {
  const [warning, setWarning] = useState<{ id: string; totalCents: number } | null>(null);
  if (cards.length === 0) return null;

  const run = async (fn: () => Promise<{ cards: SavedCard[] }>) => {
    try {
      setCards((await fn()).cards);
      setWarning(null);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  const askRemove = async (id: string) => {
    try {
      const check = await cardRemovalCheck(id);
      if (check.totalCents > 0) setWarning({ id, totalCents: check.totalCents });
      else await run(() => removeCard(id));
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Saved cards</h2>
      <ul className="space-y-2">
        {cards.map((c) => (
          <li key={c.id} className="flex items-center justify-between text-sm">
            <span className="text-gray-800">
              {c.brand} •••• {c.last4} <span className="text-gray-500">exp {c.expMonth}/{c.expYear}</span>
              {c.isDefault && <span className="ml-2 text-xs text-indigo-700">default</span>}
              {!c.accepted && <span className="ml-2 text-xs text-amber-700">not accepted here</span>}
            </span>
            <span className="flex gap-2">
              {!c.isDefault && <button className={btnLight} onClick={() => run(() => makeDefaultCard(c.id))}>Make default</button>}
              <button className={btnLight} onClick={() => askRemove(c.id)}>Remove</button>
            </span>
          </li>
        ))}
      </ul>
      {warning && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Top-ups made with this card could still be refunded ({usd(warning.totalCents)}). After you remove it they can't be.
          <div className="flex gap-2 mt-2">
            <button className={btn} onClick={() => run(() => removeCard(warning.id))}>Remove anyway</button>
            <button className={btnLight} onClick={() => setWarning(null)}>Keep it</button>
          </div>
        </div>
      )}
      <button className={`${btnLight} mt-3`} onClick={onAdd} disabled={!canAdd}>Add another card</button>
    </section>
  );
}

function AutoReloadSection({ wallet, onSaved, setMessage }: { wallet: Wallet; onSaved: () => void; setMessage: SetMessage }) {
  const [on, setOn] = useState(wallet.autoReload.on);
  const [below, setBelow] = useState(String(wallet.autoReload.below));
  const [packId, setPackId] = useState(wallet.autoReload.packId);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveAutoReload({ on, below: Number(below), packId });
      setMessage({ kind: 'ok', text: on ? 'Auto reload is on.' : 'Auto reload is off.' });
      onSaved();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Auto reload</h2>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4" /> When my balance goes under
        </label>
        <input type="number" min={1} value={below} onChange={(e) => setBelow(e.target.value)} className="w-24 border border-gray-300 rounded-lg px-2 py-1" />
        <span>{wallet.creditName}, buy</span>
        <select value={packId} onChange={(e) => setPackId(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1">
          {wallet.packs.map((p) => <option key={p.id} value={p.id}>{usd(p.payCents)} ({units(p.credits, wallet.creditName)})</option>)}
        </select>
        <span>with my default card.</span>
        <button className={btn} onClick={save} disabled={saving}>Save</button>
      </div>
      <p className="text-xs text-gray-500 mt-2">At most {wallet.autoReload.maxPerDay} times a day. A decline turns it off.</p>
    </section>
  );
}

function RefundSection({ wallet, onDone, setMessage }: { wallet: Wallet; onDone: () => Promise<void>; setMessage: SetMessage }) {
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    try {
      setRows((await fetchRefundOptions()).purchases);
      setCount(0);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  };

  // Refunds go newest first without gaps: picking a top-up picks every refundable one newer than it
  const refundable = (rows ?? []).filter((r) => r.refundable > 0);
  const chosen = refundable.slice(0, count);
  const total = chosen.reduce((s, r) => s + r.refundable, 0);

  const submit = async () => {
    setBusy(true);
    try {
      const out = await requestRefund(chosen.map((r) => r.paymentIntent), reason);
      setMessage({ kind: 'ok', text: `${usd(out.refunded)} is on its way back to your card.` });
      setRows(null);
      await onDone();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card}>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Refunds</h2>
      <p className="text-sm text-gray-600 mb-3">
        Unused bought {wallet.creditName} can go back to the card within {wallet.refundDays} days of buying them (from an hour
        after). A pack's bonus goes with it, and bonus already spent comes off the refund. Refundable now: {usd(wallet.refundable)}.
      </p>
      {rows === null ? (
        <button className={btnLight} onClick={open} disabled={wallet.status !== 'active'}>Request a refund</button>
      ) : (
        <div>
          {rows.length === 0 && <p className="text-sm text-gray-500">No top-ups yet.</p>}
          <ul className="space-y-2">
            {rows.map((r) => {
              const idx = refundable.indexOf(r);
              return (
                <li key={r.paymentIntent} className="text-sm flex items-start gap-2">
                  <input type="checkbox" className="mt-1 h-4 w-4" disabled={idx < 0} checked={idx >= 0 && idx < count}
                    onChange={(e) => setCount(e.target.checked ? idx + 1 : idx)} />
                  <span>
                    {shortDate(r.createdAt)}: {usd(r.paidCents)} for {units(r.credits, wallet.creditName)}
                    {r.card.last4 ? ` (•••• ${r.card.last4})` : ''} —{' '}
                    {r.refundable > 0 ? <strong>{usd(r.refundable)} refundable</strong> : <span className="text-gray-500">{r.reason}</span>}
                    {r.reason === 'clearing' && r.refundableFrom && <span className="text-gray-500"> until {new Date(r.refundableFrom).toLocaleTimeString()}</span>}
                    {r.deductions.length > 0 && (
                      <span className="block text-xs text-gray-500">
                        Used: {r.deductions.map((d) => `${d.note} (${d.amount.toLocaleString()})`).join('; ')}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {refundable.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400}
                className="flex-1 min-w-48 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
              <button className={btn} onClick={submit} disabled={busy || count === 0}>Refund {usd(total)}</button>
              <button className={btnLight} onClick={() => setRows(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
