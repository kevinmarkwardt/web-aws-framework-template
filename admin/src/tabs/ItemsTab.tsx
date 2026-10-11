// The template's example entity across all users: a starting point for your own entity's admin tab (registered in
// tabs/app.ts; API: GET /api/admin/items and DELETE /api/admin/items/{uid}/{itemId} in api/routes/admin.py).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, DataTable, Input, Loading, Notice, PageHeader, Panel, dateTime, useLoad } from '@yourapp/shared';
import { api } from '../api';
import ReasonDialog from '../components/ReasonDialog';
import { userLink } from '../session';
import type { AdminItem } from '../types';

export default function ItemsTab() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const { data, error, reload } = useLoad(() => api.items({ q, cursor }), [q, cursor]);
  const [doomed, setDoomed] = useState<AdminItem | null>(null);
  return (
    <div>
      <PageHeader title="Items" subtitle="Every user's items, newest first (the example entity: replace it with yours)." />
      <Panel padded={false}>
        <form className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setCursor(null); setHistory([]); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name contains (this page)" className="max-w-xs py-1.5" />
          <Button size="sm" type="submit">Filter</Button>
        </form>
        {error && <Notice tone="danger" className="m-3">{error}</Notice>}
        {!data ? <Loading /> : (
          <DataTable
            rows={data.items}
            rowKey={(i) => `${i.userId}/${i.itemId}`}
            empty="No items."
            columns={[
              { key: 'name', header: 'Name', render: (i) => <span className="font-medium">{i.name}</span> },
              { key: 'status', header: 'Status', render: (i) => <Badge tone={i.status === 'ACTIVE' ? 'ok' : 'neutral'}>{i.status}</Badge> },
              { key: 'owner', header: 'Owner', render: (i) => <Link className="text-brand-700 hover:underline" to={userLink(i.userId)}>{i.email || i.userId}</Link> },
              { key: 'created', header: 'Created', render: (i) => <span className="whitespace-nowrap text-muted">{dateTime(i.createdAt)}</span> },
              { key: 'del', header: '', render: (i) => <Button size="sm" variant="ghost" onClick={() => setDoomed(i)}>Delete</Button> },
            ]}
          />
        )}
        {(history.length > 0 || data?.cursor) && (
          <div className="flex gap-2 border-t border-line p-3">
            <Button size="sm" disabled={!history.length} onClick={() => { setCursor(history[history.length - 1] ?? null); setHistory((h) => h.slice(0, -1)); }}>Newer</Button>
            <Button size="sm" disabled={!data?.cursor} onClick={() => { setHistory((h) => [...h, cursor]); setCursor(data?.cursor ?? null); }}>Older</Button>
          </div>
        )}
      </Panel>
      <ReasonDialog open={!!doomed} title={`Delete "${doomed?.name ?? ''}"`} confirmLabel="Delete" danger onClose={() => setDoomed(null)}
        description="Deletes the item from the owner's account. This can't be undone."
        onConfirm={async (reason) => {
          if (doomed) await api.deleteItem(doomed.userId, doomed.itemId, reason);
          reload();
        }} />
    </div>
  );
}
