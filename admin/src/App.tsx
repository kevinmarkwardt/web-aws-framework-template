import { useCallback, useEffect, useState } from 'react';
import { ApiError, Loading, Notice } from '@yourapp/shared';
import { api, SIGNED_OUT_EVENT } from './api';
import { getUser, logout } from './auth';
import Layout from './Layout';
import NotAuthorizedPage from './pages/NotAuthorizedPage';
import SignInPage from './pages/SignInPage';
import { MeContext } from './session';
import type { AdminMe } from './types';

type Gate =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'not-admin'; email: string }
  | { state: 'error'; message: string }
  | { state: 'ready'; me: AdminMe };

/** Signed in, and an admin? The API decides (GET /api/admin/me: the Cognito group and the profile flag, every call). */
async function check(): Promise<Gate> {
  const user = await getUser();
  if (!user) return { state: 'signed-out' };
  try {
    return { state: 'ready', me: await api.me() };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { state: 'signed-out' };
    if (e instanceof ApiError && e.status === 403) return { state: 'not-admin', email: user.username };
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export default function App() {
  const [gate, setGate] = useState<Gate>({ state: 'loading' });
  const refresh = useCallback(() => {
    check().then(setGate);
  }, []);

  useEffect(() => {
    let live = true;
    check().then((g) => live && setGate(g));
    // any admin call answered 401 (session expired): back to the sign-in page
    const onSignedOut = () => setGate({ state: 'signed-out' });
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => {
      live = false;
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, []);

  const signOut = useCallback(async () => {
    await logout().catch(() => {});
    setGate({ state: 'signed-out' });
  }, []);

  switch (gate.state) {
    case 'loading':
      return <div className="min-h-screen bg-surface"><Loading label="Checking your access…" /></div>;
    case 'signed-out':
      return <SignInPage onSignedIn={refresh} />;
    case 'not-admin':
      return <NotAuthorizedPage email={gate.email} onSignOut={signOut} />;
    case 'error':
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-6">
          <div className="max-w-md space-y-3">
            <Notice tone="danger">The admin API didn't answer: {gate.message}</Notice>
            <button className="text-sm text-brand-700 underline" onClick={refresh}>Try again</button>
          </div>
        </div>
      );
    case 'ready':
      return (
        <MeContext.Provider value={gate.me}>
          <Layout onSignOut={signOut} />
        </MeContext.Provider>
      );
  }
}
