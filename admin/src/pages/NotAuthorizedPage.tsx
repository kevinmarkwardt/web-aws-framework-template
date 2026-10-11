import { Button } from '@yourapp/shared';
import { Icon } from '../icons';

/** Signed in, but not an admin of this site (the API answered 403 NOT_ADMIN). */
export default function NotAuthorizedPage({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const site = import.meta.env.VITE_SITE_URL;
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md rounded-card border border-line bg-panel p-8 text-center shadow-sm">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger"><Icon name="shield" className="h-6 w-6" /></span>
        <h1 className="mt-4 text-lg font-semibold text-ink">Not authorized</h1>
        <p className="mt-2 text-sm text-muted">
          {email ? <><span className="font-medium text-ink">{email}</span> isn't</> : "This account isn't"} an admin of this site.
          If it should be, ask an admin to grant access (or run <code className="rounded bg-raised px-1">scripts/make-admin.py</code>),
          then sign in again.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={onSignOut}>Sign out</Button>
          {site && <a href={site} className="inline-flex items-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Go to the site</a>}
        </div>
      </div>
    </div>
  );
}
