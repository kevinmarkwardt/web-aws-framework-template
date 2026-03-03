import { useEffect, useState } from 'react';
import { fetchItems, createItem, deleteItem } from '../../api';
import type { Item, CreateItemRequest } from '../../types';
import ItemsTable from '../../components/ItemsTable';
import AddItemForm from '../../components/AddItemForm';

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchItems();
      setItems(data);
    } catch {
      setError('Failed to load items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    alert(`Edit item: ${item.name} — add edit UI here`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Items</h1>
          <p className="text-sm text-gray-500 mt-1">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Item
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add New Item</h2>
          <AddItemForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <ItemsTable items={items} onDelete={handleDelete} onEdit={handleEdit} />
      </div>
    </div>
  );
}
