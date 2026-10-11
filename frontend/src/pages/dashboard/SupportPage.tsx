import { useState } from 'react';
import { Badge, Button, Field, Loading, Notice, Panel, Select, Textarea, dateTime, useLoad } from '@yourapp/shared';
import { addToSupportRequest, createSupportRequest, fetchSupport } from '../../api';
import type { SupportRequest } from '../../types';

/** Support requests (api/routes/support.py): write in, follow up while a request is open, read the answers. Support
 *  answers on the admin site; the reply also arrives as an account alert and an email. */
export default function SupportPage() {
  const { data, error, reload } = useLoad(fetchSupport, []);
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(false);

  if (error && !data) return <Notice tone="danger">{error}</Notice>;
  if (!data) return <Loading />;

  const open = data.requests.filter((r) => r.status === 'open').length;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await createSupportRequest(topic || data.topics[0]?.id || 'other', message);
      setMessage('');
      setSent(true);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sending failed');
    }
    setBusy(false);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Support</h1>
        <p className="mt-1 text-sm text-muted">Ask us anything about your account or billing. We answer by email and here.</p>
      </div>

      <Panel title="New request">
        {open >= data.maxOpen ? (
          <Notice tone="warn">You have {open} open requests. Add to one of them below, or wait for an answer.</Notice>
        ) : (
          <form onSubmit={send} className="space-y-4">
            {sent && <Notice tone="ok">Sent. We'll get back to you soon.</Notice>}
            {formError && <Notice tone="danger">{formError}</Notice>}
            <Field label="Topic">
              <Select value={topic || data.topics[0]?.id} onChange={(e) => setTopic(e.target.value)}>
                {data.topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Message" hint="At least a sentence, so we can help.">
              <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} required />
            </Field>
            <Button type="submit" variant="primary" busy={busy} disabled={message.trim().length < 10}>Send</Button>
          </form>
        )}
      </Panel>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-ink">Your requests</h2>
        {data.requests.length === 0 ? (
          <p className="text-sm text-faint">No requests yet.</p>
        ) : (
          data.requests.map((r) => <RequestCard key={r.id} request={r} onChanged={reload} />)
        )}
      </div>
    </div>
  );
}

function RequestCard({ request: r, onChanged }: { request: SupportRequest; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await addToSupportRequest(r.id, text);
      setText('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sending failed');
    }
    setBusy(false);
  };
  return (
    <Panel
      title={r.topicLabel}
      actions={<Badge tone={r.status === 'open' ? 'brand' : 'neutral'}>{r.status === 'open' ? 'Open' : 'Closed'}</Badge>}
    >
      <p className="text-xs text-faint">{dateTime(r.createdAt)}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{r.message}</p>
      {r.replies.map((x, i) => (
        <div key={i} className={`mt-3 border-l-2 pl-3 ${x.by === 'support' ? 'border-brand-500' : 'border-line'}`}>
          <p className="text-xs text-faint">{x.by === 'support' ? 'Support' : 'You'} · {dateTime(x.at)}</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{x.text}</p>
        </div>
      ))}
      {r.status === 'open' && (
        <div className="mt-4 space-y-2">
          {error && <Notice tone="danger">{error}</Notice>}
          <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a message" maxLength={4000} />
          <Button size="sm" busy={busy} disabled={text.trim().length < 2} onClick={add}>Add to this request</Button>
        </div>
      )}
    </Panel>
  );
}
