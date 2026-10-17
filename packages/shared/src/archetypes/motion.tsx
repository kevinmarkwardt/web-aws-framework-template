/** Content that eases in as it scrolls into view. One orchestrated reveal per section beats animating every element
 *  (ai/design-guidelines.md); reduced-motion visitors see it in place, no movement. */
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useInView, useReducedMotion } from './motion-hooks';

/** Fades and lifts its content in the first time it scrolls into view. `delay` (ms) staggers siblings. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className, y = 16 }:
  { children: ReactNode; delay?: number; as?: ElementType; className?: string; y?: number }) {
  const [ref, inView] = useInView<HTMLElement>({ amount: 0.15 });
  const reduced = useReducedMotion();
  const shown = inView || reduced;
  const style: CSSProperties = reduced ? {} : {
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : `translateY(${y}px)`,
    transition: `opacity 700ms cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 700ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
  };
  return <Tag ref={ref} className={className} style={style}>{children}</Tag>;
}
