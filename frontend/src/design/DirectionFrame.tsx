import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Direction } from './types';

/** Re-scopes the theme variables to one direction. Everything inside uses the direction's tokens (Tailwind utilities
 *  read the variables), so three directions can render on one page without touching the site's own theme. */
export default function DirectionFrame({ direction, theme, children }: { direction: Direction; theme: 'light' | 'dark'; children: ReactNode }) {
  useFonts(direction.fonts);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(direction.tokens)) vars[`--${k}`] = v;
  if (theme === 'dark') for (const [k, v] of Object.entries(direction.dark ?? {})) vars[`--${k}`] = v;
  return (
    <div
      data-direction={direction.id}
      style={{ ...(vars as CSSProperties), colorScheme: theme, background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--typeface-body)', minHeight: '100vh' }}
    >
      {children}
    </div>
  );
}

/** Adds one Google Fonts stylesheet per family set (the preview only; the chosen fonts ship via init.py). */
function useFonts(families?: string[]) {
  const key = (families ?? []).join('|');
  useEffect(() => {
    if (!key) return;
    const href = `https://fonts.googleapis.com/css2?${key.split('|').map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=swap`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [key]);
}
