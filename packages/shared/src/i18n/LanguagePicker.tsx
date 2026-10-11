import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './languages';
import { currentLanguage, switchLanguage } from './setup';

/** The site's language, as a select. Renders nothing while the site has one language (LANGUAGES). `onChange` runs after
 *  the switch: the signed-in pages save it on the profile there (PUT /api/account/settings {language}). */
export function LanguagePicker({ onChange, className }: { onChange?: (code: string) => void; className?: string }) {
  const { t } = useTranslation();
  if (LANGUAGES.length < 2) return null;
  return (
    <select
      aria-label={t('common.language')}
      value={currentLanguage()}
      onChange={(e) => {
        const code = e.target.value;
        switchLanguage(code).then(() => onChange?.(code));
      }}
      className={className ?? 'rounded-lg border border-line bg-panel px-2 py-1 text-sm text-ink'}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.name}</option>
      ))}
    </select>
  );
}
