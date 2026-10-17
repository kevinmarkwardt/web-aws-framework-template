import { TotpCodeForm, useTranslation } from '@yourapp/shared';
import { Icon } from '../icons';

/** The second sign-in step for an account with an authenticator app (every admin when adminMfa is on). */
export default function MfaCodePage({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-brand-ink"><Icon name="shield" className="h-6 w-6" /></span>
          <h1 className="text-lg font-semibold text-ink">{t('admin.mfa.codeTitle')}</h1>
        </div>
        <div className="rounded-card border border-line bg-panel p-6 shadow-sm">
          <TotpCodeForm onDone={onDone} onCancel={onCancel} />
        </div>
      </div>
    </div>
  );
}
