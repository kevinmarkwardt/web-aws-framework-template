import { useState } from 'react';
import { Button, Field, Input, Notice } from '@yourapp/shared';
import { Icon } from '../icons';
import { login, MOCK_AUTH } from '../auth';

/** The admin site's own sign-in: the same accounts as the user site (one Cognito pool), a separate session. */
export default function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await login(email, password);
      if (!out.done) {
        setError('This account needs another step to sign in. Finish signing in on the main site first, then come back.');
      } else {
        onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shield" className="h-6 w-6" /></span>
          <div>
            <h1 className="text-lg font-semibold text-ink">YourApp admin</h1>
            <p className="text-sm text-muted">Sign in with your YourApp account.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-panel p-6 shadow-sm">
          {MOCK_AUTH && <Notice tone="warn">Local mock sign-in (no Cognito pool configured): any email and password signs you in as a mock admin.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Email">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" busy={busy} className="w-full">Sign in</Button>
        </form>
        <p className="mt-4 text-center text-xs text-faint">Only admins get in. Access is checked on every request.</p>
      </div>
    </div>
  );
}
