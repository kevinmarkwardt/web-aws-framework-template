import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, DataTable, Drawer, Input, Loading, Notice, PageHeader, Panel, Select, creditsOn, num, shortDate, subscriptionsOn, useLoad, useTranslation } from '@yourapp/shared';
import type { Column } from '@yourapp/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { AdminUser } from '../types';
import UserDetail, { StatusBadge } from './UserDetail';

/** Users, newest first (the API reads list-index a page at a time, never a table scan). Search matches email, name or
 *  id; a row opens the user's detail with the actions. ?user=<id> opens it directly (links from other tabs). */
export default function UsersTab() {
  const { t } = useTranslation();
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
    { key: 'user', header: t('adminUsers.list.colUser'), render: (u) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-ink">{u.email}</div>
        {u.name && <div className="truncate text-xs text-faint">{u.name}</div>}
      </div>
    ) },
    { key: 'status', header: t('adminUsers.list.colStatus'), render: (u) => <StatusBadge user={u} /> },
    ...(subscriptionsOn(me.billingMode) ? [{ key: 'plan', header: t('adminUsers.list.colPlan'), render: (u: AdminUser) => <span className="capitalize">{u.plan}</span> }] : []),
    ...(creditsOn(me.billingMode) ? [{ key: 'balance', header: t('adminUsers.list.colBalance'), numeric: true, render: (u: AdminUser) => num(u.credits ?? 0) }] : []),
    { key: 'items', header: t('adminUsers.list.colItems'), numeric: true, render: (u) => num(u.itemCount) },
    { key: 'joined', header: t('adminUsers.list.colJoined'), render: (u) => <span className="whitespace-nowrap text-muted">{shortDate(u.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader title={t('adminUsers.list.title')} subtitle={t('adminUsers.list.subtitle')} />
      <Panel padded={false}>
        <form
          className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery((q) => ({ ...q, q: text.trim() }));
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('adminUsers.list.searchPlaceholder')} className="max-w-xs py-1.5" />
          <Select value={query.status} onChange={(e) => setQuery((q) => ({ ...q, status: e.target.value }))} className="w-36 py-1.5">
            <option value="">{t('adminUsers.list.anyStatus')}</option>
            <option value="active">{t('adminUsers.list.statusActive')}</option>
            <option value="suspended">{t('adminUsers.list.statusSuspended')}</option>
            <option value="banned">{t('adminUsers.list.statusBanned')}</option>
          </Select>
          <Button type="submit" size="sm">{t('adminUsers.list.search')}</Button>
          {(query.q || query.status) && (
            <Button size="sm" variant="ghost" onClick={() => { setText(''); setQuery({ q: '', status: '' }); }}>{t('adminUsers.list.clear')}</Button>
          )}
        </form>
        {first.error && <Notice tone="danger" className="m-3">{first.error}</Notice>}
        {first.loading && !first.data ? <Loading /> : (
          <DataTable columns={columns} rows={rows} rowKey={(u) => u.userId} onRowClick={(u) => open(u.userId)} selected={selected}
            empty={query.q || query.status ? t('adminUsers.list.noMatch') : t('adminUsers.list.empty')} />
        )}
        {(cursor || moreError) && (
          <div className="flex items-center gap-3 border-t border-line p-3">
            {cursor && <Button size="sm" busy={loadingMore} onClick={loadMore}>{t('adminUsers.list.loadMore')}</Button>}
            {moreError && <span className="text-sm text-danger">{moreError}</span>}
            {query.q && <span className="text-xs text-faint">{t('adminUsers.list.batchHint')}</span>}
          </div>
        )}
      </Panel>

      <Drawer open={!!selected} title={t('adminUsers.list.drawerTitle')} onClose={() => open(null)}>
        {selected && <UserDetail key={selected} userId={selected} onChanged={first.reload} />}
      </Drawer>
    </div>
  );
}
