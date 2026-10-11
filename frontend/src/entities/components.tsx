/** Entity pieces the generated pages share on the user site: a card for grids, a link to a referenced record (by its
 *  name), and the records of other entities that point at one (a chef's recipes). */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EntityImage, Loading, Pager, useLoad, useTranslation } from '@yourapp/shared';
import { contractByName, titleOf } from '@yourapp/shared/contracts';
import type { EntityContract, EntityRecord } from '@yourapp/shared/contracts';
import { siteApi } from './client';
import { entityHref, siteArea } from './paths';

/** A record as a card: its image (if the entity has one), its name and up to two more fields. */
export function EntityCard({ contract, record, to, details }: {
  contract: EntityContract; record: EntityRecord; to: string; details?: React.ReactNode;
}) {
  const title = titleOf(contract, record);
  return (
    <Link to={to} className="group flex flex-col overflow-hidden rounded-card border border-line bg-panel transition-shadow hover:shadow-md">
      {contract.imageField && (
        <div className="aspect-[4/3] overflow-hidden bg-raised">
          <EntityImage src={record[contract.imageField]} alt={title} className="transition-transform group-hover:scale-[1.02]" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-display text-base font-semibold text-ink line-clamp-2 break-words">{title}</h3>
        {details && <div className="text-sm text-muted">{details}</div>}
      </div>
    </Link>
  );
}

// referenced records' names, fetched once per page load
const names = new Map<string, Promise<string>>();

function nameOf(c: EntityContract, id: string): Promise<string> {
  const key = `${c.name}:${id}`;
  if (!names.has(key)) names.set(key, siteApi(c).get(id).then((r) => titleOf(c, r), () => id));
  return names.get(key)!;
}

/** The name of the `entity` record `id`, linked to its page when it has one. */
export function RefLink({ entity, id }: { entity: string; id: string }) {
  const c = contractByName(entity);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (c) nameOf(c, id).then((n) => live && setName(n));
    return () => {
      live = false;
    };
  }, [c, id]);
  const href = entityHref(entity, 'detail', id);
  const label = name ?? '…';
  return href ? <Link to={href} className="text-brand-700 hover:underline">{label}</Link> : <span>{label}</span>;
}

/** Records of `contract` whose ref `field` is `id`, as a small grid with pages. Nothing when there are none. */
export function RelatedList({ contract, field, id }: { contract: EntityContract; field: string; id: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => siteApi(contract).list({ filters: { [field]: id }, page, pageSize: 12 }), [contract.name, field, id, page]);
  if (!data) return <Loading />;
  if (!data.total) return null;
  return (
    <section className="mt-10">
      <h2 className="font-display mb-4 text-lg font-semibold text-ink">
        {t(`${siteArea(contract)}.many`)} <span className="text-sm font-normal text-faint">({data.total})</span>
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {data.items.map((r) => (
          <EntityCard key={r.id} contract={contract} record={r} to={entityHref(contract.name, 'detail', r.id)} />
        ))}
      </div>
      <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </section>
  );
}
