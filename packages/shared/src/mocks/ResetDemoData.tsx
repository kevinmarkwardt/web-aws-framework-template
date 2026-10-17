import { useTranslation } from 'react-i18next';
import { mocksOn, resetDemoData } from './state';

/** "Reset demo data": a menu entry for dev and test builds while any entity is mocked (nothing otherwise). Put it in a
 *  menu; style it like the entries around it. */
export function ResetDemoData({ className }: { className?: string }) {
  const { t } = useTranslation();
  if (!mocksOn()) return null;
  return (
    <button type="button" className={className} onClick={() => { if (window.confirm(t('common.demo.resetConfirm'))) resetDemoData(); }}>
      {t('common.demo.reset')}
    </button>
  );
}
