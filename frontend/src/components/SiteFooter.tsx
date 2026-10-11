import { Link } from 'react-router-dom';
import { LanguagePicker, useTranslation } from '@yourapp/shared';
import { SITE } from '../site';

/** The footer of every page: Terms and Privacy links, and the language picker (shown once the site has two or more
 *  languages). `onLanguage` lets signed-in pages save the choice on the profile. */
export default function SiteFooter({ onLanguage }: { onLanguage?: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-gray-100 py-8 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <p className="text-gray-500">{t('app.footer.copyright', { year: new Date().getFullYear(), name: SITE.displayName })}</p>
        <nav aria-label={t('app.footer.label')} className="flex items-center gap-5">
          <Link to="/terms" className="text-gray-500 hover:text-gray-900">{t('app.footer.terms')}</Link>
          <Link to="/privacy" className="text-gray-500 hover:text-gray-900">{t('app.footer.privacy')}</Link>
          <LanguagePicker onChange={onLanguage} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700" />
        </nav>
      </div>
    </footer>
  );
}
