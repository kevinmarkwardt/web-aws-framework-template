import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, Field, Notice, Textarea, useTranslation } from '@yourapp/shared';

/** Every account or money action asks why: the reason goes in the audit log with the admin's id (the API refuses an
 *  empty one). `children` adds the action's own fields (days, amount, ...). */
export default function ReasonDialog({ open, title, description, confirmLabel, danger, children, onConfirm, onClose, canConfirm = true }: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  children?: ReactNode;
  canConfirm?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    setReason('');
    setError('');
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  return (
    <Dialog
      open={open}
      title={title}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{t('adminUsers.reason.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!reason.trim() || !canConfirm} onClick={confirm}>{confirmLabel ?? t('adminUsers.reason.confirm')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {description && <div className="text-sm text-muted">{description}</div>}
        {children}
        <Field label={t('adminUsers.reason.label')} hint={t('adminUsers.reason.hint')}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
