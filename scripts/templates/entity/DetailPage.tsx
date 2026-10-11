// One __Entity__ on the Detail archetype: its picture, name and fields, then the records of other entities that point at
// it. With an image field the layout is `split` (picture beside the facts), without one `document`; the design
// direction may pick `stacked` instead. Texts: locales/{lang}/entity-__plural__.json (__area__).
// #if userWrites
import { useContext } from 'react';
// #endif
import { useParams } from 'react-router-dom';
import { FieldValue, useLoad, useTranslation } from '@yourapp/shared';
// #if userWrites
import { ActionButton, Detail } from '@yourapp/shared/archetypes';
// #else
import { Detail } from '@yourapp/shared/archetypes';
// #endif
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
/** Long text reads as the page body; everything else is a fact. */
const BODY = FIELDS.filter((f) => f.type === 'text');
const FACTS = FIELDS.filter((f) => f.type !== 'text');
const RELATED = referencing('__Entity__');
const IMAGE = __contract__.imageField;

export default function __Entity__DetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  // #if userWrites
  const { user } = useContext(AuthContext);
  // #endif
  const { data, error } = useLoad(() => __entities__Api.get(id), [id]);
  const value = (name: string, v: string) => t(`__area__.values.${name}.${v}`, { defaultValue: v });
  const show = (f: (typeof FIELDS)[number]) => data && (
    <FieldValue field={f} value={data[f.name]} valueLabel={(v) => value(f.name, v)} renderRef={(rid) => <RefLink entity={f.ref ?? ''} id={rid} />} />
  );
  const crumbs = [{ label: t('__area__.many'), href: entityHref('__Entity__', 'list') }, ...(data ? [{ label: titleOf(__contract__, data) }] : [])];

  return (
    <Shell>
      <Detail
        variant={IMAGE ? 'split' : 'document'}
        crumbs={crumbs}
        loading={!data && !error}
        notFound={!!error}
        eyebrow={t('__area__.one')}
        title={data ? titleOf(__contract__, data) : undefined}
        image={IMAGE && data ? (data[IMAGE] as string | null) : undefined}
        facts={FACTS.map((f) => ({ label: t(`__area__.fields.${f.name}`), value: show(f) }))}
        body={BODY.length > 0 ? BODY.map((f) => <div key={f.name}>{show(f)}</div>) : undefined}
        // #if userWrites
        actions={user && data && data.ownerId === user.userId
          ? <ActionButton action={{ label: t('__area__.edit'), href: entityHref('__Entity__', 'edit', data.id), variant: 'secondary' }} className="w-full" />
          : undefined}
        // #endif
        related={data && RELATED.length > 0 ? {
          title: t('__area__.related'),
          content: RELATED.map((r) => <RelatedList key={`${r.contract.name}.${r.field}`} contract={r.contract} field={r.field} id={data.id} />),
        } : undefined}
      />
    </Shell>
  );
}
