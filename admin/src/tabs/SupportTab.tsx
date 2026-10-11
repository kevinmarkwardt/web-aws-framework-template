import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Empty, Loading, Notice, PageHeader, Panel, Textarea, dateTime, useLoad } from '@yourapp/shared';
import { api } from '../api';
import { userLink } from '../session';
import type { Ticket } from '../types';

function TicketCard({ t, onDone }: { t: Ticket; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (body: { reply?: string; status?: 'open' | 'closed' }) => {
    setBusy(true);
    setError('');
    try {
      await api.supportUpdate(t.id, body);
      setReply('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <Panel
      title={<span>{t.topicLabel} · <Link to={userLink(t.userId)} className="font-normal text-brand-700 hover:underline">{t.email || t.userId}</Link></span>}
      actions={<><span className="text-xs text-faint">{dateTime(t.createdAt)}</span><Badge tone={t.status === 'open' ? 'brand' : 'neutral'}>{t.status}</Badge></>}
    >
      <p className="whitespace-pre-wrap text-sm text-ink">{t.message}</p>
      {t.replies.map((r, i) => (
        <div key={i} className={`mt-3 border-l-2 pl-3 text-sm ${r.by === 'customer' ? 'border-line' : 'border-brand-500'}`}>
          <p className="text-xs text-faint">{r.by === 'customer' ? 'Customer' : `Support (${r.by})`} · {dateTime(r.at)}</p>
          <p className="whitespace-pre-wrap text-ink">{r.text}</p>
        </div>
      ))}
      <Textarea className="mt-4" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000}
        placeholder="Reply (the customer sees it from &quot;Support&quot;, as an account alert and an email)" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" busy={busy} disabled={!reply.trim()} onClick={() => run({ reply, status: 'closed' })}>Reply and close</Button>
        <Button size="sm" busy={busy} disabled={!reply.trim()} onClick={() => run({ reply })}>Reply, keep open</Button>
        <Button size="sm" variant="ghost" busy={busy} onClick={() => run({ status: t.status === 'open' ? 'closed' : 'open' })}>
          {t.status === 'open' ? 'Close without reply' : 'Reopen'}
        </Button>
      </div>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
    </Panel>
  );
}

/** Support requests from the site's Support page. Replies reach the customer as an alert and an email. */
export default function SupportTab() {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const { data, error, reload } = useLoad(() => api.support(status), [status]);
  return (
    <div>
      <PageHeader title="Support" subtitle="Requests from the site's Support page. Each one also emails the admin address." />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-panel p-0.5">
        {(['open', 'closed', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1 text-sm capitalize ${status === s ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
            {s}{data && s !== 'all' ? ` (${data.counts[s]})` : ''}
          </button>
        ))}
      </div>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {!data ? <Loading /> : !data.requests.length ? <Empty>No {status === 'all' ? '' : status} requests.</Empty> : (
        <div className="space-y-4">{data.requests.map((t) => <TicketCard key={t.id} t={t} onDone={reload} />)}</div>
      )}
    </div>
  );
}
