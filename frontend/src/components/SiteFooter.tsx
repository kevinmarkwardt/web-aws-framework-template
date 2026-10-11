import { Link } from 'react-router-dom';
import { LanguagePicker, useTranslation } from '@yourapp/shared';
import { SITE } from '../site';

/** The footer of every page: Terms and Privacy links, and the language picker (shown once the site has two or more
 *  languages). `onLanguage` lets signed-in pages save the choice on the profile. */
export default function SiteFooter({ onLanguage }: { onLanguage?: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-line bg-surface py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <p className="text-muted">{t('app.footer.copyright', { year: new Date().getFullYear(), name: SITE.displayName })}</p>
        <nav aria-label={t('app.footer.label')} className="flex items-center gap-5">
          <Link to="/terms" className="text-muted hover:text-ink">{t('app.footer.terms')}</Link>
          <Link to="/privacy" className="text-muted hover:text-ink">{t('app.footer.privacy')}</Link>
          <LanguagePicker onChange={onLanguage} className="rounded-control border border-line bg-panel px-2 py-1 text-sm text-ink" />
        </nav>
      </div>
    </footer>
  );
}
