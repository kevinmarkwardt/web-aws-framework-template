import { useCallback, useEffect, useState } from 'react';
import { dismissNote, fetchNotes } from './api';
import type { AccountNote } from './types';

/** Account alerts (GET /api/account/notes: auto reload results, warnings, failed payments, a ban...), shown in the
 *  user menu. Dismissed ones are gone for good; the rest expire after 30 days. */
export function useAccountNotes(): { notes: AccountNote[]; dismiss: (id: string) => void } {
  const [notes, setNotes] = useState<AccountNote[]>([]);

  useEffect(() => {
    let live = true;
    fetchNotes().then((r) => live && setNotes(r.notes)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotes((n) => n.filter((x) => x.id !== id));
    dismissNote(id).catch(() => {});
  }, []);

  return { notes, dismiss };
}
