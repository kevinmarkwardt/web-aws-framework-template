// Create (no :id) or edit (:id) one of the signed-in user's __plural__, and delete it. Under /dashboard (signed in).
// Texts: locales/{lang}/entity-__plural__.json (__area__).
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Field, FieldInput, Loading, Notice, useLoad, useTranslation } from '@yourapp/shared';
import { __contract__ } from '@yourapp/shared/contracts';
import type { __Entity__Input } from '@yourapp/shared/contracts';
import { useRefOptions } from '../hooks';
import { entityHref } from '../paths';
import { __entities__Api } from './api';

const empty = () => Object.fromEntries(__contract__.fields.map((f) => [f.name, f.type === 'tags' ? [] : null])) as Record<string, unknown>;

export default function __Entity__FormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useLoad(() => (id ? __entities__Api.get(id) : Promise.resolve(null)), [id]);
  // the edits so far; until the first one, the record being edited (or an empty one)
  const [edits, setEdits] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refOptions = useRefOptions(__contract__.fields);
  const value = (name: string, v: string) => t(`__area__.values.${name}.${v}`, { defaultValue: v });
  const draft = edits ?? (id ? (existing.data ? { ...empty(), ...existing.data } : null) : empty());
  const setDraft = (change: (d: Record<string, unknown>) => Record<string, unknown>) => setEdits(change(draft ?? empty()));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const body = Object.fromEntries(__contract__.fields.map((f) => [f.name, draft[f.name]])
        .filter(([, v]) => id || (v !== null && v !== ''))) as Partial<__Entity__Input>;
      const saved = id ? await __entities__Api.update(id, body) : await __entities__Api.create(body as __Entity__Input);
      navigate(entityHref('__Entity__', 'detail', saved.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id || !window.confirm(t('__area__.confirmDelete'))) return;
    setBusy(true);
    try {
      await __entities__Api.remove(id);
      navigate(entityHref('__Entity__', 'mine'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (existing.error) return <Notice tone="danger">{existing.error}</Notice>;
  if (!draft) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">{id ? t('__area__.edit') : t('__area__.new')}</h1>
      <form onSubmit={save} className="space-y-5 rounded-card border border-line bg-panel p-6">
        {error && <Notice tone="danger">{error}</Notice>}
        {__contract__.fields.map((f) => (
          <Field key={f.name} label={`${t(`__area__.fields.${f.name}`)}${f.required ? ' *' : ''}`}>
            <FieldInput field={f} value={draft[f.name]} onChange={(v) => setDraft((d) => ({ ...d, [f.name]: v }))}
              valueLabel={(v) => value(f.name, v)} refOptions={f.ref ? refOptions[f.ref] : undefined} />
          </Field>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          {id ? <Button variant="danger" onClick={remove} disabled={busy}>{t('__area__.delete')}</Button> : <span />}
          <Button type="submit" variant="primary" busy={busy}>{id ? t('__area__.save') : t('__area__.create')}</Button>
        </div>
      </form>
    </div>
  );
}
