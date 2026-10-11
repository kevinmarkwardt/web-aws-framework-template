import { Fragment, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { shortDate, useTranslation } from '@yourapp/shared';
import SiteFooter from '../components/SiteFooter';
import { SITE } from '../site';

interface Doc {
  title: string;
  intro: string[];
  sections: { h: string; p: string[] }[];
}

/** {{displayName}}, {{domain}}, {{contactEmail}} from SITE. */
const fill = (s: string) =>
  s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in SITE ? String(SITE[k as keyof typeof SITE]) : m));

/** Email addresses and web addresses in the text become links. */
function linked(text: string): ReactNode {
  return text.split(/(https?:\/\/[^\s)]+[^\s).,]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g).map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline break-all">{part}</a>;
    }
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(part)) {
      return <a key={i} href={`mailto:${part}`} className="text-brand-600 hover:underline">{part}</a>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Paragraphs, with runs of "- " lines as a list. */
function Body({ p }: { p: string[] }) {
  const blocks: (string | string[])[] = [];
  for (const line of p.map(fill)) {
    const last = blocks[blocks.length - 1];
    if (line.startsWith('- ')) {
      if (Array.isArray(last)) last.push(line.slice(2));
      else blocks.push([line.slice(2)]);
    } else blocks.push(line);
  }
  return (
    <>
      {blocks.map((b, i) => Array.isArray(b)
        ? <ul key={i} className="list-disc pl-5 space-y-1.5 text-ink">{b.map((li, j) => <li key={j}>{linked(li)}</li>)}</ul>
        : <p key={i} className="text-ink">{linked(b)}</p>)}
    </>
  );
}

/** The Terms of Service (/terms) and Privacy Policy (/privacy): the text is locales/{lang}/legal.json, in every site
 *  language. The English skeleton has [TODO: ...] markers (entity name, address, governing law, retention) to fill in
 *  before launch; have it reviewed. */
export default function LegalPage({ doc }: { doc: 'terms' | 'privacy' }) {
  const { t } = useTranslation();
  const d = t(`legal.${doc}`, { returnObjects: true }) as Doc;
  useEffect(() => {
    const before = document.title;
    document.title = `${d.title} | ${SITE.displayName}`;
    return () => {
      document.title = before;
    };
  }, [d.title]);
  useEffect(() => {
    // a link to one section (/terms#s4) lands on it
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [doc]);
  const other = doc === 'terms' ? '/privacy' : '/terms';
  return (
    <div className="min-h-screen bg-panel">
      <header className="border-b border-line">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center">
          <Link to="/" className="text-lg font-bold text-ink">{SITE.displayName}</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-8 leading-relaxed">
        <h1 className="text-3xl sm:text-4xl font-bold text-ink">{d.title}</h1>
        <p className="text-sm text-muted mt-3">{t('legal.updated', { date: shortDate(SITE.legalUpdated) })}</p>
        <div className="mt-6 space-y-4"><Body p={d.intro} /></div>

        <nav aria-label={t('legal.contents')} className="mt-8 rounded-xl border border-line bg-surface p-4 sm:p-5">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">{t('legal.contents')}</div>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {d.sections.map((s, i) => (
              <li key={i}><a href={`#s${i + 1}`} className="text-ink hover:text-ink">{s.h}</a></li>
            ))}
          </ol>
        </nav>

        {d.sections.map((s, i) => (
          <section key={i} id={`s${i + 1}`} className="scroll-mt-6">
            <h2 className="text-xl font-semibold text-ink mt-10 mb-3">{s.h}</h2>
            <div className="space-y-3"><Body p={s.p} /></div>
          </section>
        ))}

        <p className="mt-12 pt-6 border-t border-line text-sm">
          <Link to={other} className="text-brand-600 hover:underline">{t(`legal.otherDoc.${doc}`)}</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
