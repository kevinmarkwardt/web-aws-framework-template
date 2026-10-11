import { shortDate, useTranslation } from '@yourapp/shared';
import type { Item } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  items: Item[];
  onDelete: (itemId: string) => void;
  onEdit: (item: Item) => void;
  /** The account is read-only (banned): no edit or delete. */
  readOnly?: boolean;
}

export default function ItemsTable({ items, onDelete, onEdit, readOnly = false }: Props) {
  const { t } = useTranslation();
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium">{t('items.table.empty')}</p>
        <p className="text-sm mt-1">{t('items.table.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-600 uppercase text-xs tracking-wider">
            <th className="px-4 py-3 border-b">{t('items.table.name')}</th>
            <th className="px-4 py-3 border-b">{t('items.table.status')}</th>
            <th className="px-4 py-3 border-b">{t('items.table.created')}</th>
            <th className="px-4 py-3 border-b">{t('items.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemId} className="border-b hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="px-4 py-3 text-gray-500">
                {shortDate(item.createdAt)}
              </td>
              <td className="px-4 py-3 flex gap-2">
                <button
                  onClick={() => onEdit(item)}
                  disabled={readOnly}
                  className="text-brand-600 hover:text-brand-800 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('items.table.edit')}
                </button>
                <button
                  onClick={() => {
                    if (confirm(t('items.table.confirmDelete', { name: item.name }))) onDelete(item.itemId);
                  }}
                  disabled={readOnly}
                  className="text-red-500 hover:text-red-700 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('items.table.delete')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
