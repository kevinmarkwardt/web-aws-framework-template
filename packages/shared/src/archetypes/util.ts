export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Column count from `lg` up (below that, archetype grids are 1 then 2 columns). */
export const COLS: Record<2 | 3 | 4, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };
