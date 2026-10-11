// One __Entity__: its picture, name and fields, then the records of other entities that point at it.
// Texts: locales/{lang}/entity-__plural__.json (__area__).
// #if userWrites
import { useContext } from 'react';
// #endif
import { Link, useParams } from 'react-router-dom';
import { EntityImage, FieldValue, Loading, Notice, useLoad, useTranslation } from '@yourapp/shared';
import { __contract__, referencing, titleOf } from '@yourapp/shared/contracts';
// #if userWrites
import { AuthContext } from '../../auth-context';
// #endif
import { RefLink, RelatedList } from '../components';
import { entityHref } from '../paths';
import { __Shell__ as Shell } from '../shell';
import { __entities__Api } from './api';

/** Every field but the name and the picture (those head the page). */
const FIELDS = __contract__.fields.filter((f) => f.name !== __contract__.titleField && f.name !== __contract__.imageField);
const RELATED = referencing('__Entity__');

export default function __Entity__DetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  // #if userWrites
  const { user } = useContext(AuthContext);
  // #endif
  const { data, error } = useLoad(() => __entities__Api.get(id), [id]);
  const back = <Link to={entityHref('__Entity__', 'list')} className="text-sm text-brand-700 hover:underline">← {t('__area__.back')}</Link>;
  const value = (name: string, v: string) => t(`__area__.values.${name}.${v}`, { defaultValue: v });

  if (error) {
    return (
      <Shell>
        {back}
        <h1 className="font-display mt-6 text-2xl font-semibold text-ink">{t('__area__.notFound')}</h1>
        <Notice className="mt-4">{error}</Notice>
      </Shell>
    );
  }
  if (!data) return <Shell><Loading /></Shell>;
  const title = titleOf(__contract__, data);

  return (
    <Shell>
      {back}
      <article className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {__contract__.imageField && (
          <div className="aspect-[4/3] overflow-hidden rounded-card bg-raised">
            <EntityImage src={data[__contract__.imageField]} alt={title} />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">{t('__area__.one')}</p>
          <h1 className="font-display mt-1 text-3xl font-semibold tracking-tight text-ink break-words">{title}</h1>
          {/* #if userWrites */}
          {user && data.ownerId === user.userId && (
            <Link to={entityHref('__Entity__', 'edit', data.id)} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
              {t('__area__.edit')}
            </Link>
          )}
          {/* #endif */}
          <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[10rem_1fr]">
            {FIELDS.map((f) => (
              <div key={f.name} className="contents">
                <dt className="text-sm font-medium text-muted">{t(`__area__.fields.${f.name}`)}</dt>
                <dd className="min-w-0 text-sm text-ink">
                  <FieldValue field={f} value={data[f.name]} valueLabel={(v) => value(f.name, v)}
                    renderRef={(rid) => <RefLink entity={f.ref ?? ''} id={rid} />} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </article>
      {RELATED.map((r) => <RelatedList key={`${r.contract.name}.${r.field}`} contract={r.contract} field={r.field} id={data.id} />)}
    </Shell>
  );
}
