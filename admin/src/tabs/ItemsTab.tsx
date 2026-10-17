// The template's example entity across all users: a starting point for your own entity's admin tab (registered in
// tabs/app.ts; API: GET /api/admin/items and DELETE /api/admin/items/{uid}/{itemId} in api/routes/admin.py).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, DataTable, Input, Loading, Notice, PageHeader, Panel, dateTime, useLoad, useTranslation } from '@yourapp/shared';
import { api } from '../api';
import ReasonDialog from '../components/ReasonDialog';
import { userLink } from '../session';
import type { AdminItem } from '../types';

export default function ItemsTab() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const { data, error, reload } = useLoad(() => api.items({ q, cursor }), [q, cursor]);
  const [doomed, setDoomed] = useState<AdminItem | null>(null);
  return (
    <div>
      <PageHeader title={t('admin.items.title')} subtitle={t('admin.items.subtitle')} />
      <Panel padded={false}>
        <form className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setCursor(null); setHistory([]); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('admin.items.filterPlaceholder')} className="max-w-xs py-1.5" />
          <Button size="sm" type="submit">{t('admin.actions.filter')}</Button>
        </form>
        {error && <Notice tone="danger" className="m-3">{error}</Notice>}
        {!data ? <Loading /> : (
          <DataTable
            rows={data.items}
            rowKey={(i) => `${i.userId}/${i.itemId}`}
            empty={t('admin.items.empty')}
            columns={[
              { key: 'name', header: t('admin.items.name'), render: (i) => <span className="font-medium">{i.name}</span> },
              { key: 'status', header: t('admin.items.status'), render: (i) => <Badge tone={i.status === 'ACTIVE' ? 'ok' : 'neutral'}>{i.status}</Badge> },
              { key: 'owner', header: t('admin.items.owner'), render: (i) => <Link className="text-brand-700 hover:underline" to={userLink(i.userId)}>{i.email || i.userId}</Link> },
              { key: 'created', header: t('admin.items.created'), render: (i) => <span className="whitespace-nowrap text-muted">{dateTime(i.createdAt)}</span> },
              { key: 'del', header: '', render: (i) => <Button size="sm" variant="ghost" onClick={() => setDoomed(i)}>{t('admin.actions.delete')}</Button> },
            ]}
          />
        )}
        {(history.length > 0 || data?.cursor) && (
          <div className="flex gap-2 border-t border-line p-3">
            <Button size="sm" disabled={!history.length} onClick={() => { setCursor(history[history.length - 1] ?? null); setHistory((h) => h.slice(0, -1)); }}>{t('admin.items.newer')}</Button>
            <Button size="sm" disabled={!data?.cursor} onClick={() => { setHistory((h) => [...h, cursor]); setCursor(data?.cursor ?? null); }}>{t('admin.items.older')}</Button>
          </div>
        )}
      </Panel>
      <ReasonDialog open={!!doomed} title={t('admin.items.deleteTitle', { name: doomed?.name ?? '' })} confirmLabel={t('admin.actions.delete')} danger onClose={() => setDoomed(null)}
        description={t('admin.items.deleteDescription')}
        onConfirm={async (reason) => {
          if (doomed) await api.deleteItem(doomed.userId, doomed.itemId, reason);
          reload();
        }} />
    </div>
  );
}
