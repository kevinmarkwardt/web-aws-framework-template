import { useContext, useEffect, useState } from 'react';
import { useTranslation } from '@yourapp/shared';
import { AuthContext } from '../../auth-context';
import { fetchItems, createItem, deleteItem } from '../../api';
import type { Item, CreateItemRequest } from '../../types';
import ItemsTable from '../../components/ItemsTable';
import AddItemForm from '../../components/AddItemForm';
import UpgradeBanner from '../../components/UpgradeBanner';
import RestrictedNote from '../../components/RestrictedNote';
import { canWrite } from '../../standing';

export default function ItemsPage() {
  const { user } = useContext(AuthContext);
  const { t } = useTranslation();
  const writable = canWrite(user);  // banned = read-only (the API refuses writes too)
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchItems();
      setItems(data);
    } catch {
      setError(t('items.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (data: CreateItemRequest) => {
    await createItem(data);
    setShowForm(false);
    await load();
  };

  const handleDelete = async (itemId: string) => {
    await deleteItem(itemId);
    setItems((prev) => prev.filter((i) => i.itemId !== itemId));
  };

  const handleEdit = (item: Item) => {
    // TODO: open an edit modal or inline editor
    alert(t('items.editTodo', { name: item.name }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-label={t('common.loading')}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('items.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {user && user.itemLimit !== null
              ? t('items.countOfLimit', { count: items.length, limit: user.itemLimit })
              : t('items.count', { count: items.length })}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={!writable}
          className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('items.add')}
        </button>
      </div>

      <RestrictedNote need="write" />

      {user && <UpgradeBanner user={user} itemCount={items.length} />}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {showForm && writable && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('items.addTitle')}</h2>
          <AddItemForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <ItemsTable items={items} onDelete={handleDelete} onEdit={handleEdit} readOnly={!writable} />
      </div>
    </div>
  );
}
