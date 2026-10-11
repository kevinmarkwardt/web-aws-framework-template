import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, DataTable, Drawer, Input, Loading, Notice, PageHeader, Panel, Select, creditsOn, num, shortDate, subscriptionsOn, useLoad } from '@yourapp/shared';
import type { Column } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { AdminUser } from '../types';
import UserDetail, { StatusBadge } from './UserDetail';

/** Users, newest first (the API reads list-index a page at a time, never a table scan). Search matches email, name or
 *  id; a row opens the user's detail with the actions. ?user=<id> opens it directly (links from other tabs). */
export default function UsersTab() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const selected = params.get('user');
  const [text, setText] = useState('');
  const [query, setQuery] = useState({ q: '', status: '' });
  const first = useLoad(() => api.users(query), [query.q, query.status]);
  const queryKey = JSON.stringify(query);
  const [more, setMore] = useState<{ key: string; users: AdminUser[]; cursor: string | null }>({ key: '', users: [], cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');

  const extra = more.key === queryKey ? more : { key: queryKey, users: [], cursor: first.data?.cursor ?? null };
  const cursor = extra.users.length ? extra.cursor : first.data?.cursor ?? null;
  const rows = [...(first.data?.users ?? []), ...extra.users];

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError('');
    try {
      const r = await api.users({ ...query, cursor });
      setMore({ key: queryKey, users: [...extra.users, ...r.users], cursor: r.cursor });
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : String(e));
    }
    setLoadingMore(false);
  };
  const open = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('user', id);
      else p.delete('user');
      return p;
    });

  const columns: Column<AdminUser>[] = [
    { key: 'user', header: 'User', render: (u) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{u.email}</div>
        {u.name && <div className="truncate text-xs text-faint">{u.name}</div>}
      </div>
    ) },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge user={u} /> },
    ...(subscriptionsOn(me.billingMode) ? [{ key: 'plan', header: 'Plan', render: (u: AdminUser) => <span className="capitalize">{u.plan}</span> }] : []),
    ...(creditsOn(me.billingMode) ? [{ key: 'balance', header: 'Balance', numeric: true, render: (u: AdminUser) => num(u.credits ?? 0) }] : []),
    { key: 'items', header: 'Items', numeric: true, render: (u) => num(u.itemCount) },
    { key: 'joined', header: 'Joined', render: (u) => <span className="whitespace-nowrap text-muted">{shortDate(u.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Users" subtitle="Newest first. Click a user for their details and the account actions." />
      <Panel padded={false}>
        <form
          className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery((q) => ({ ...q, q: text.trim() }));
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Email, name or user id" className="max-w-xs py-1.5" />
          <Select value={query.status} onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value }))} className="w-36 py-1.5">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="banned">Banned</option>
          </Select>
          <Button type="submit" size="sm">Search</Button>
          {(query.q || query.status) && (
            <Button size="sm" variant="ghost" onClick={() => { setText(''); setQuery({ q: '', status: '' }); }}>Clear</Button>
          )}
        </form>
        {first.error && <Notice tone="danger" className="m-3">{first.error}</Notice>}
        {first.loading && !first.data ? <Loading /> : (
          <DataTable columns={columns} rows={rows} rowKey={(u) => u.userId} onRowClick={(u) => open(u.userId)} selected={selected}
            empty={query.q || query.status ? 'No users match.' : 'No users yet.'} />
        )}
        {(cursor || moreError) && (
          <div className="flex items-center gap-3 border-t border-line p-3">
            {cursor && <Button size="sm" busy={loadingMore} onClick={loadMore}>Load more</Button>}
            {moreError && <span className="text-sm text-danger">{moreError}</span>}
            {query.q && <span className="text-xs text-faint">A search reads users in batches; more may match further on.</span>}
          </div>
        )}
      </Panel>

      <Drawer open={!!selected} title="User" onClose={() => open(null)}>
        {selected && <UserDetail key={selected} userId={selected} onChanged={first.reload} />}
      </Drawer>
    </div>
  );
}
