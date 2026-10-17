import { useState } from 'react';
import { useTranslation } from '@yourapp/shared';
import type { CreateItemRequest } from '../types';

interface Props {
  onSubmit: (data: CreateItemRequest) => Promise<void>;
  onCancel: () => void;
}

export default function AddItemForm({ onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), status });
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('items.form.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{t('items.form.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('items.form.namePlaceholder')}
          className="w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink mb-1">{t('items.form.status')}</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="ACTIVE">{t('items.status.ACTIVE')}</option>
          <option value="INACTIVE">{t('items.status.INACTIVE')}</option>
        </select>
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 px-4 py-2 bg-brand-600 text-brand-ink text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {loading ? t('items.form.adding') : t('items.form.submit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-line-strong text-ink text-sm font-medium rounded-lg hover:bg-raised transition-colors"
        >
          {t('items.form.cancel')}
        </button>
      </div>
    </form>
  );
}
