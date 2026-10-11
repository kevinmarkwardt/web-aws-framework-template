import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Empty, Loading, Notice, PageHeader, Panel, Textarea, dateTime, useLoad, useTranslation } from '@yourapp/shared';
import { api } from '../api';
import { userLink } from '../session';
import type { Ticket } from '../types';

const FILTER_LABELS = { open: 'admin.support.filter.open', closed: 'admin.support.filter.closed', all: 'admin.support.filter.all' } as const;
const EMPTY = { open: 'admin.support.emptyOpen', closed: 'admin.support.emptyClosed', all: 'admin.support.emptyAll' } as const;

function TicketCard({ t: ticket, onDone }: { t: Ticket; onDone: () => void }) {
  const { t } = useTranslation();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (body: { reply?: string; status?: 'open' | 'closed' }) => {
    setBusy(true);
    setError('');
    try {
      await api.supportUpdate(ticket.id, body);
      setReply('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <Panel
      title={<span>{ticket.topicLabel} · <Link to={userLink(ticket.userId)} className="font-normal text-brand-700 hover:underline">{ticket.email || ticket.userId}</Link></span>}
      actions={<><span className="text-xs text-faint">{dateTime(ticket.createdAt)}</span><Badge tone={ticket.status === 'open' ? 'brand' : 'neutral'}>{ticket.status}</Badge></>}
    >
      <p className="whitespace-pre-wrap text-sm text-ink">{ticket.message}</p>
      {ticket.replies.map((r, i) => (
        <div key={i} className={`mt-3 border-l-2 pl-3 text-sm ${r.by === 'customer' ? 'border-line' : 'border-brand-500'}`}>
          <p className="text-xs text-faint">{r.by === 'customer' ? t('admin.support.customer') : t('admin.support.supportBy', { by: r.by })} · {dateTime(r.at)}</p>
          <p className="whitespace-pre-wrap text-ink">{r.text}</p>
        </div>
      ))}
      <Textarea className="mt-4" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000}
        placeholder={t('admin.support.replyPlaceholder')} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" busy={busy} disabled={!reply.trim()} onClick={() => run({ reply, status: 'closed' })}>{t('admin.support.replyAndClose')}</Button>
        <Button size="sm" busy={busy} disabled={!reply.trim()} onClick={() => run({ reply })}>{t('admin.support.replyKeepOpen')}</Button>
        <Button size="sm" variant="ghost" busy={busy} onClick={() => run({ status: ticket.status === 'open' ? 'closed' : 'open' })}>
          {ticket.status === 'open' ? t('admin.support.closeWithoutReply') : t('admin.support.reopen')}
        </Button>
      </div>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
    </Panel>
  );
}

/** Support requests from the site's Support page. Replies reach the customer as an alert and an email. */
export default function SupportTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const { data, error, reload } = useLoad(() => api.support(status), [status]);
  return (
    <div>
      <PageHeader title={t('admin.support.title')} subtitle={t('admin.support.subtitle')} />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-panel p-0.5">
        {(['open', 'closed', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1 text-sm capitalize ${status === s ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
            {t(FILTER_LABELS[s])}{data && s !== 'all' ? ` (${data.counts[s]})` : ''}
          </button>
        ))}
      </div>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!data ? <Loading /> : !data.requests.length ? <Empty>{t(EMPTY[status])}</Empty> : (
        <div className="space-y-4">{data.requests.map((r) => <TicketCard key={r.id} t={r} onDone={reload} />)}</div>
      )}
    </div>
  );
}
