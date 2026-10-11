import { useEffect, useMemo, useRef, useState } from 'react';
import { encode } from 'uqr';
import { confirmTotpSignIn, finishTotpSetup, startTotpSetup } from './mfa';
import { Button, Field, Input, Notice, Spinner } from './ui';

// Authenticator-app (TOTP) screens both sites can use (mfa.ts has the Cognito calls):
//   TotpCodeForm  the second sign-in step for an account with an authenticator app
//   TotpSetup     add an app: QR code (or the key typed in), then one code to confirm
//   QrCode        an SVG QR code drawn from `text` (no images, no network, nothing for the CSP to allow)

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

const codeInputProps = {
  inputMode: 'numeric' as const,
  autoComplete: 'one-time-code',
  pattern: '[0-9 ]{6,7}',
  maxLength: 7,
  required: true,
  placeholder: '123456',
};

/** A QR code as inline SVG: one path for the dark modules on a white square (scanners need the light quiet zone). */
export function QrCode({ text, size = 192, label = 'QR code' }: { text: string; size?: number; label?: string }) {
  const { path, n } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 4 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }));
    return { path: d, n: qr.size };
  }, [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The second sign-in step: the 6-digit code from the account's authenticator app. */
export function TotpCodeForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (await confirmTotpSignIn(code)) onDone();
      else setError('Sign-in needs another step this site does not support.');
    } catch (err) {
      setError(message(err, 'That code did not work. Try the newest one.'));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Code">
        <Input {...codeInputProps} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy} className="flex-1">Verify</Button>
        {onCancel && <Button onClick={onCancel}>Back</Button>}
      </div>
    </form>
  );
}

/** Add an authenticator app to the signed-in Cognito user, then turn TOTP on. `issuer` is the name the app shows. */
export function TotpSetup({ issuer, account, onDone }: { issuer: string; account: string; onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // once per mount (StrictMode runs effects twice in dev; each start makes Cognito issue a new secret)
    if (started.current) return;
    started.current = true;
    startTotpSetup(issuer, account).then(setSetup, (e) => setError(message(e, 'Could not start the setup. Sign in again.')));
  }, [issuer, account]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await finishTotpSetup(code);
      onDone();
    } catch (err) {
      setError(message(err, 'That code did not work. Try the newest one.'));
    }
    setBusy(false);
  };

  if (!setup) return error ? <Notice tone="danger">{error}</Notice> : <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Open an authenticator app (Google Authenticator, 1Password, Authy, ...).</li>
        <li>Scan this code, or enter the key by hand.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <div className="flex justify-center rounded-lg border border-line bg-white p-3">
        <QrCode text={setup.uri} label={`QR code for ${issuer}`} />
      </div>
      <div className="text-center text-xs text-muted">
        Key: <code className="select-all break-all font-mono text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        {' · '}
        <a href={setup.uri} className="underline">open in an app on this device</a>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label="Code from the app">
        <Input {...codeInputProps} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" busy={busy} className="w-full">Turn on</Button>
    </form>
  );
}
