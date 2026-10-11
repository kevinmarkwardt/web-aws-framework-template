import type { ComponentType } from 'react';

/** The pages every direction shows, so directions compare like for like. */
export const DIRECTION_PAGES = ['home', 'browse', 'detail'] as const;
export type DirectionPage = (typeof DIRECTION_PAGES)[number];

/** The brand-50..950 scale from one accent color (it becomes brand-600), mixed toward white and black in oklch, so a
 *  direction only has to pick one accent. */
export function ramp(accent: string): Record<string, string> {
  const mix = (p: number, to: 'white' | 'black') => `color-mix(in oklch, ${accent} ${p}%, ${to})`;
  return {
    'brand-50': mix(8, 'white'), 'brand-100': mix(15, 'white'), 'brand-200': mix(30, 'white'), 'brand-300': mix(50, 'white'),
    'brand-400': mix(72, 'white'), 'brand-500': mix(88, 'white'), 'brand-600': accent, 'brand-700': mix(85, 'black'),
    'brand-800': mix(70, 'black'), 'brand-900': mix(55, 'black'), 'brand-950': mix(38, 'black'),
  };
}

/** One design direction for the /__directions preview (non-prod builds only).
 *  A direction is a structure AND a look: its own page compositions (archetype variants, navigation model, density,
 *  card vs list, image weight) plus token values. The AI builds three during the playbook's design step (copy an
 *  example from design/examples/), the user picks or mixes, and the winner's tokens go into site.spec.yaml
 *  `design.tokens` -> `scripts/init.py --apply-design` -> theme.css. */
export interface Direction {
  id: string;
  name: string;
  /** one sentence: the idea behind it, shown above the preview */
  idea: string;
  /** theme.css variables without the leading dashes: { 'brand-600': 'oklch(...)', ink: '#1f1b16', 'typeface-display': '"Fraunces", serif' } */
  tokens: Record<string, string>;
  /** overrides for dark mode (same keys) */
  dark?: Record<string, string>;
  /** Google Fonts families to load for the preview, e.g. ['Fraunces:opsz,wght@9..144,400..700', 'Inter:wght@400..700'] */
  fonts?: string[];
  pages: Record<DirectionPage, ComponentType>;
}
