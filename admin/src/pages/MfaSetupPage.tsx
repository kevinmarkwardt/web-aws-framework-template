import { Button, TotpSetup, useTranslation } from '@yourapp/shared';
import { Icon } from '../icons';

/** An admin without an authenticator app (the API answered 403 MFA_REQUIRED; the stack's adminMfa flag): add one here.
 *  After the code checks out, every sign-in (on both sites: one Cognito account) asks for a code. */
export default function MfaSetupPage({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-brand-ink"><Icon name="shield" className="h-6 w-6" /></span>
          <div>
            <h1 className="text-lg font-semibold text-ink">{t('admin.mfa.setupTitle')}</h1>
            <p className="text-sm text-muted">{t('admin.mfa.setupBody')}</p>
          </div>
        </div>
        <div className="rounded-card border border-line bg-panel p-6 shadow-sm">
          <TotpSetup issuer="YourApp" account={email} onDone={onDone} />
        </div>
        <div className="mt-4 flex justify-center">
          <Button size="sm" onClick={onSignOut}>{t('admin.actions.signOut')}</Button>
        </div>
      </div>
    </div>
  );
}
