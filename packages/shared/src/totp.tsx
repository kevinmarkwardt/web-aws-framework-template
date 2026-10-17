import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { encode } from 'uqr';
import { confirmTotpSignIn, finishTotpSetup, startTotpSetup } from './mfa';
import { Button, Field, Input, Notice, Spinner } from './ui';

// Authenticator-app (TOTP) screens both sites can use (mfa.ts has the Cognito calls):
//   TotpCodeForm  the second sign-in step for an account with an authenticator app
//   TotpSetup     add an app: QR code (or the key typed in), then one code to confirm
//   QrCode        an SVG QR code drawn from `text` (no images, no network, nothing for the CSP to allow)
// Texts: common.mfa.* (packages/shared/src/locales/{lang}/common.json).

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
export function QrCode({ text, size = 192, label }: { text: string; size?: number; label?: string }) {
  const { t } = useTranslation();
  const { path, n } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 4 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }));
    return { path: d, n: qr.size };
  }, [text]);
  return (
    <svg role="img" aria-label={label ?? t('common.mfa.qrCode')} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The second sign-in step: the 6-digit code from the account's authenticator app. */
export function TotpCodeForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (await confirmTotpSignIn(code)) onDone();
      else setError(t('common.mfa.unsupportedStep'));
    } catch (err) {
      setError(message(err, t('common.mfa.badCode')));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted">{t('common.mfa.enterCode')}</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label={t('common.mfa.code')}>
        <Input {...codeInputProps} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={busy} className="flex-1">{t('common.mfa.verify')}</Button>
        {onCancel && <Button onClick={onCancel}>{t('common.mfa.back')}</Button>}
      </div>
    </form>
  );
}

/** Add an authenticator app to the signed-in Cognito user, then turn TOTP on. `issuer` is the name the app shows. */
export function TotpSetup({ issuer, account, onDone }: { issuer: string; account: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // once per mount (StrictMode runs effects twice in dev; each start makes Cognito issue a new secret)
    if (started.current) return;
    started.current = true;
    startTotpSetup(issuer, account).then(setSetup, (e) => setError(message(e, t('common.mfa.setupFailed'))));
  }, [issuer, account, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await finishTotpSetup(code);
      onDone();
    } catch (err) {
      setError(message(err, t('common.mfa.badCode')));
    }
    setBusy(false);
  };

  if (!setup) return error ? <Notice tone="danger">{error}</Notice> : <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <form onSubmit={submit} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>{t('common.mfa.stepOpenApp')}</li>
        <li>{t('common.mfa.stepScan')}</li>
        <li>{t('common.mfa.stepType')}</li>
      </ol>
      <div className="flex justify-center rounded-lg border border-line bg-panel p-3">
        <QrCode text={setup.uri} label={t('common.mfa.qrCodeFor', { issuer })} />
      </div>
      <div className="text-center text-xs text-muted">
        {t('common.mfa.key')} <code className="select-all break-all font-mono text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
        {' · '}
        <a href={setup.uri} className="underline">{t('common.mfa.openInApp')}</a>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <Field label={t('common.mfa.codeFromApp')}>
        <Input {...codeInputProps} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" busy={busy} className="w-full">{t('common.mfa.turnOn')}</Button>
    </form>
  );
}
