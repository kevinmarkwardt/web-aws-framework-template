import { useCallback, useEffect, useState } from 'react';
import { ApiError, Loading, Notice, useTranslation } from '@yourapp/shared';
import { api, SIGNED_OUT_EVENT } from './api';
import { getToken, getUser, logout } from './auth';
import Layout from './Layout';
import MfaSetupPage from './pages/MfaSetupPage';
import NotAuthorizedPage from './pages/NotAuthorizedPage';
import SignInPage from './pages/SignInPage';
import { MeContext } from './session';
import type { AdminMe } from './types';

type Gate =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'not-admin'; email: string }
  | { state: 'mfa-setup'; email: string }
  | { state: 'error'; message: string }
  | { state: 'ready'; me: AdminMe };

/** The signed-in account's email from its ID token (the Cognito username is an id), for the authenticator app's label. */
async function tokenEmail(): Promise<string> {
  try {
    const payload = (await getToken())?.split('.')[1] ?? '';
    return String(JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).email ?? '');
  } catch {
    return '';
  }
}

/** Signed in, and an admin? The API decides (GET /api/admin/me: the Cognito group and the profile flag, every call). */
async function check(): Promise<Gate> {
  const user = await getUser();
  if (!user) return { state: 'signed-out' };
  try {
    return { state: 'ready', me: await api.me() };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { state: 'signed-out' };
    // an admin without an authenticator app while the stack requires one (adminMfa): set it up first
    if (e instanceof ApiError && e.status === 403 && e.code === 'MFA_REQUIRED') {
      return { state: 'mfa-setup', email: (await tokenEmail()) || user.username };
    }
    if (e instanceof ApiError && e.status === 403) return { state: 'not-admin', email: user.username };
    return { state: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export default function App() {
  const { t } = useTranslation();
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
      return <div className="min-h-screen bg-surface"><Loading label={t('admin.app.checkingAccess')} /></div>;
    case 'signed-out':
      return <SignInPage onSignedIn={refresh} />;
    case 'not-admin':
      return <NotAuthorizedPage email={gate.email} onSignOut={signOut} />;
    case 'mfa-setup':
      return <MfaSetupPage email={gate.email} onDone={refresh} onSignOut={signOut} />;
    case 'error':
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-6">
          <div className="max-w-md space-y-3">
            <Notice tone="danger">{t('admin.app.apiDown', { message: gate.message })}</Notice>
            <button className="text-sm text-brand-700 underline" onClick={refresh}>{t('admin.actions.tryAgain')}</button>
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
