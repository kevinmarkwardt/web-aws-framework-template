import { useState } from 'react';
import { Button, Field, Input, Notice, useTranslation } from '@yourapp/shared';
import { Icon } from '../icons';
import { login, MOCK_AUTH } from '../auth';

/** The admin site's own sign-in: the same accounts as the user site (one Cognito pool), a separate session. */
export default function SignInPage({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useTranslation();
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
        setError(t('admin.signIn.needsAnotherStep'));
      } else {
        onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.signIn.failed'));
    }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shield" className="h-6 w-6" /></span>
          <div>
            <h1 className="text-lg font-semibold text-ink">{t('admin.signIn.title')}</h1>
            <p className="text-sm text-muted">{t('admin.signIn.subtitle')}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-card border border-line bg-panel p-6 shadow-sm">
          {MOCK_AUTH && <Notice tone="warn">{t('admin.signIn.mockNotice')}</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label={t('admin.signIn.email')}>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label={t('admin.signIn.password')}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" busy={busy} className="w-full">{t('admin.signIn.submit')}</Button>
        </form>
        <p className="mt-4 text-center text-xs text-faint">{t('admin.signIn.footer')}</p>
      </div>
    </div>
  );
}
