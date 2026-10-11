import { Button, TotpSetup } from '@yourapp/shared';
import { Icon } from '../icons';

/** An admin without an authenticator app (the API answered 403 MFA_REQUIRED; the stack's adminMfa flag): add one here.
 *  After the code checks out, every sign-in (on both sites: one Cognito account) asks for a code. */
export default function MfaSetupPage({ email, onDone, onSignOut }: { email: string; onDone: () => void; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="shield" className="h-6 w-6" /></span>
          <div>
            <h1 className="text-lg font-semibold text-ink">Set up two-step sign-in</h1>
            <p className="text-sm text-muted">Admins need an authenticator app. From now on, signing in asks for its code.</p>
          </div>
        </div>
        <div className="rounded-card border border-line bg-panel p-6 shadow-sm">
          <TotpSetup issuer="YourApp" account={email} onDone={onDone} />
        </div>
        <div className="mt-4 flex justify-center">
          <Button size="sm" onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}
