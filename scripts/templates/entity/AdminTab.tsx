// The admin site's __Entities__ tab: every record, any owner (GET/POST/PUT/DELETE __adminPath__). The generic table +
// drawer is components/EntityAdmin.tsx; give this tab its own UI when __plural__ needs more.
// Texts: locales/en/admin-entity-__plural__.json (__adminArea__).
import { useTranslation } from '@yourapp/shared';
import { __contract__ } from '@yourapp/shared/contracts';
import EntityAdmin from '../../components/EntityAdmin';

export default function __Entities__Tab() {
  const { t } = useTranslation();
  return (
    <EntityAdmin contract={__contract__} texts={{
      title: t('__adminArea__.title'),
      subtitle: t('__adminArea__.subtitle'),
      search: t('__adminArea__.search'),
      empty: t('__adminArea__.empty'),
      create: t('__adminArea__.create'),
      edit: t('__adminArea__.edit'),
      confirmDelete: (name) => t('__adminArea__.confirmDelete', { name }),
      field: (name) => t(`__adminArea__.fields.${name}`),
      value: (field, v) => t(`__adminArea__.values.${field}.${v}`, { defaultValue: v }),
    }} />
  );
}
