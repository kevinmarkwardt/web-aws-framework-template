/** Motion hooks for the public pages. Everything respects prefers-reduced-motion: those visitors get the final state. */
import { useEffect, useRef, useState } from 'react';

/** True when the visitor asked the OS for less motion (updates live). */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** [ref, inView]: inView turns true once the element is `amount` visible (and stays true unless `repeat`). */
export function useInView<T extends Element>({ amount = 0.25, repeat = false }: { amount?: number; repeat?: boolean } = {}) {
  const ref = useRef<T>(null);
  // without IntersectionObserver (old browsers, tests) everything counts as visible
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setInView(true);
        if (!repeat) io.disconnect();
      } else if (repeat) {
        setInView(false);
      }
    }, { threshold: amount });
    io.observe(el);
    return () => io.disconnect();
  }, [amount, repeat]);
  return [ref, inView] as const;
}

/** Runs `tick` every `ms` while the element is on screen and motion is allowed. Attach `ref` to the element. */
export function useLoop<T extends Element>(tick: () => void, ms: number) {
  const [ref, inView] = useInView<T>({ amount: 0.2, repeat: true });
  const reduced = useReducedMotion();
  const saved = useRef(tick);
  useEffect(() => {
    saved.current = tick;
  });
  useEffect(() => {
    if (!inView || reduced) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [inView, reduced, ms]);
  return { ref, running: inView && !reduced, reduced };
}
