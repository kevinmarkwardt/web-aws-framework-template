import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, DataTable, Drawer, Input, JsonBlock, Loading, Notice, PageHeader, Panel, dateTime, useLoad, useTranslation, utcToday } from '@yourapp/shared';
import { api } from '../api';
import DayNav from '../components/DayNav';
import { userLink } from '../session';
import type { AuditRow } from '../types';

function Target({ target }: { target: string }) {
  if (target.startsWith('user:')) {
    return <Link className="font-mono text-xs text-brand-700 hover:underline" to={userLink(target.slice(5))}>{target}</Link>;
  }
  return <span className="font-mono text-xs">{target}</span>;
}

/** Every admin action and every automatic one (bans from warnings, dispute suspensions, refunds), by UTC day, with
 *  who, why, and before/after. Kept 18 months, no personal data. */
export default function AuditTab() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || utcToday();
  const actor = params.get('actor') || '';
  const target = params.get('target') || '';
  const [filters, setFilters] = useState({ actor, target });
  const [open, setOpen] = useState<AuditRow | null>(null);
  const { data, error } = useLoad(() => api.audit({ day, actor, target }), [day, actor, target]);
  const set = (next: Record<string, string>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(next)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      return p;
    });
  return (
    <div>
      <PageHeader title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} actions={<DayNav day={day} onChange={(d) => set({ day: d })} />} />
      <Panel padded={false}>
        <form className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => { e.preventDefault(); set({ actor: filters.actor.trim(), target: filters.target.trim() }); }}>
          <Input value={filters.actor} onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))} placeholder={t('admin.audit.actorPlaceholder')} className="w-64 py-1" />
          <Input value={filters.target} onChange={(e) => setFilters((f) => ({ ...f, target: e.target.value }))} placeholder={t('admin.audit.targetPlaceholder')} className="w-64 py-1" />
          <Button size="sm" type="submit">{t('admin.actions.filter')}</Button>
          {(actor || target) && <Button size="sm" variant="ghost" onClick={() => { setFilters({ actor: '', target: '' }); set({ actor: '', target: '' }); }}>{t('admin.actions.clear')}</Button>}
        </form>
        {error && <Notice tone="danger" className="m-3">{error}</Notice>}
        {!data ? <Loading /> : (
          <DataTable
            rows={data.entries}
            rowKey={(a) => a.sk}
            onRowClick={setOpen}
            empty={t('admin.audit.empty')}
            columns={[
              { key: 'at', header: t('admin.audit.when'), render: (a) => <span className="whitespace-nowrap text-muted">{dateTime(a.at)}</span> },
              { key: 'actor', header: t('admin.audit.actor'), render: (a) => <span className="font-mono text-xs">{a.actor}</span> },
              { key: 'action', header: t('admin.audit.action'), render: (a) => <span className="font-medium">{a.action}</span> },
              { key: 'target', header: t('admin.audit.target'), render: (a) => <Target target={a.target} /> },
              { key: 'reason', header: t('admin.audit.reason'), render: (a) => <span className="text-muted">{a.reason}</span> },
            ]}
          />
        )}
      </Panel>
      <Drawer open={!!open} title={open?.action ?? t('admin.audit.entryTitle')} onClose={() => setOpen(null)}>
        {open && (
          <div className="space-y-4 text-sm">
            <p><span className="text-faint">{t('admin.audit.by')}</span> <span className="font-mono">{open.actor}</span> · {dateTime(open.at)}</p>
            <p><span className="text-faint">{t('admin.audit.on')}</span> <Target target={open.target} /></p>
            <p><span className="text-faint">{t('admin.audit.reason')}</span> {open.reason || '—'}</p>
            {open.before && <div><p className="mb-1 text-xs text-faint">{t('admin.audit.before')}</p><JsonBlock value={open.before} /></div>}
            {open.after && <div><p className="mb-1 text-xs text-faint">{t('admin.audit.after')}</p><JsonBlock value={open.after} /></div>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
