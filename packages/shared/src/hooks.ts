import { useCallback, useEffect, useState } from 'react';

export interface Loaded<T> {
  /** The latest answer (kept while a newer one loads; key the component by id to start empty). */
  data: T | null;
  error: string;
  /** True until the answer for the current deps (and reload count) has arrived. */
  loading: boolean;
  /** Fetch again. */
  reload: () => void;
}

/** Load something when `deps` change: { data, error, loading, reload }. An answer that arrives after the deps changed
 *  again (or the component unmounted) is dropped. `deps` must be JSON-serialisable (ids, filters, page cursors). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [n, setN] = useState(0);
  const key = JSON.stringify([...deps, n]);
  const [state, setState] = useState<{ data: T | null; error: string; key: string }>({ data: null, error: '', key: '' });
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ data, error: '', key }),
      (e) => live && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e), key })),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== key, reload };
}
