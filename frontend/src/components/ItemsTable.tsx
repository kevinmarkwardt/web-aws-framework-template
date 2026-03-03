import type { Item } from '../types';
import StatusBadge from './StatusBadge';

interface Props {
  items: Item[];
  onDelete: (itemId: string) => void;
  onEdit: (item: Item) => void;
}

export default function ItemsTable({ items, onDelete, onEdit }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium">No items yet</p>
        <p className="text-sm mt-1">Add your first item to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-600 uppercase text-xs tracking-wider">
            <th className="px-4 py-3 border-b">Name</th>
            <th className="px-4 py-3 border-b">Status</th>
            <th className="px-4 py-3 border-b">Created</th>
            <th className="px-4 py-3 border-b">Actions</th>
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
                {new Date(item.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 flex gap-2">
                <button
                  onClick={() => onEdit(item)}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${item.name}"?`)) onDelete(item.itemId);
                  }}
                  className="text-red-500 hover:text-red-700 text-sm font-medium"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
