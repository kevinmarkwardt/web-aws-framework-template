import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Container, SmartLink } from './parts';
import { cx } from './util';

export interface NavItem {
  label: ReactNode;
  href: string;
}

/** The public site's top bar: brand, primary nav, and a right slot (sign in / account menu). Collapses to a menu
 *  button under `md`. `variant`: `bar` (solid, bordered), `floating` (transparent over a cover hero), `centered`
 *  (brand centered above the nav, editorial sites). */
export function SiteHeader({ brand, nav, right, variant = 'bar', sticky = true }:
  { brand: ReactNode; nav: NavItem[]; right?: ReactNode; variant?: 'bar' | 'floating' | 'centered'; sticky?: boolean }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const link = ({ isActive }: { isActive: boolean }) =>
    cx('text-sm font-medium transition-colors', isActive ? 'text-ink' : 'text-muted hover:text-ink');
  const navLinks = nav.map((n, i) =>
    n.href.startsWith('/') ? (
      <NavLink key={`${i}${n.href}`} to={n.href} className={link} onClick={() => setOpen(false)}>{n.label}</NavLink>
    ) : (
      <SmartLink key={`${i}${n.href}`} href={n.href} className="text-sm font-medium text-muted hover:text-ink">{n.label}</SmartLink>
    ));

  return (
    <header className={cx(
      'z-30 w-full',
      sticky && 'sticky top-0',
      variant === 'floating' ? 'absolute inset-x-0 top-0 bg-transparent' : 'border-b border-line bg-panel/95 backdrop-blur',
    )}>
      <Container width="wide">
        {variant === 'centered' ? (
          <div className="flex flex-col items-center gap-3 py-5">
            <SmartLink href="/" className="font-display text-2xl font-semibold tracking-tight text-ink">{brand}</SmartLink>
            <div className="flex w-full items-center justify-between gap-6 md:justify-center">
              <nav aria-label={t('common.archetypes.mainNav')} className="hidden items-center gap-7 md:flex">{navLinks}</nav>
              <div className="md:absolute md:right-8">{right}</div>
            </div>
          </div>
        ) : (
          <div className="flex h-16 items-center justify-between gap-6">
            <SmartLink href="/" className="flex shrink-0 items-center gap-2 font-display text-lg font-semibold tracking-tight text-ink">{brand}</SmartLink>
            <nav aria-label={t('common.archetypes.mainNav')} className="hidden flex-1 items-center gap-7 md:flex">{navLinks}</nav>
            <div className="hidden md:block">{right}</div>
            <button
              type="button"
              className="rounded-control p-2 text-ink hover:bg-raised md:hidden"
              aria-expanded={open}
              aria-label={open ? t('common.archetypes.closeMenu') : t('common.archetypes.openMenu')}
              onClick={() => setOpen((v) => !v)}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" d={open ? 'M6 6l12 12M18 6 6 18' : 'M4 7h16M4 12h16M4 17h16'} />
              </svg>
            </button>
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-4 border-t border-line py-4 md:hidden">
            <nav aria-label={t('common.archetypes.mainNav')} className="flex flex-col gap-3">{navLinks}</nav>
            {right}
          </div>
        )}
      </Container>
    </header>
  );
}
