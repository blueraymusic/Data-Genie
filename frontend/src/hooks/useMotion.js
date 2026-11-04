import { useEffect, useRef, useState } from 'react';

const query = '(prefers-reduced-motion: reduce)';
const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
const preference = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => preference()?.matches ?? true);
  useEffect(() => {
    const media = preference();
    if (!media) return;
    const changed = () => setReduced(media.matches);
    changed();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', changed);
      return () => media.removeEventListener?.('change', changed);
    }
    media.addListener?.(changed);
    return () => media.removeListener?.(changed);
  }, []);
  return reduced;
}

export function useEnterMotion(ref, key) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (reduced || !node || typeof node.animate !== 'function') return;
    // Reading or editing a focused control takes precedence over decoration.
    if (node.contains(document.activeElement)) return;
    let animation;
    try {
      animation = node.animate([{ opacity: 0.65 }, { opacity: 1 }], {
        duration: 200,
        easing,
      });
    } catch {
      return;
    }
    const cancel = () => animation?.cancel?.();
    node.addEventListener('focusin', cancel);
    return () => {
      node.removeEventListener('focusin', cancel);
      cancel();
    };
  }, [ref, key, reduced]);
}

export function useScrollReveal(ref, selector) {
  const reduced = useReducedMotion();
  const revealed = useRef(new WeakSet());
  useEffect(() => {
    const root = ref.current;
    if (reduced || !root || !selector || typeof IntersectionObserver !== 'function') return;
    const targets = [...root.querySelectorAll(selector)].filter(
      (node) => typeof node.animate === 'function' && !revealed.current.has(node),
    );
    if (!targets.length) return;
    const animations = new Map();
    let disposed = false;
    const cancel = (node, animation) => {
      animations.delete(node);
      if (animation) animation.onfinish = null;
      animation?.cancel?.();
    };
    let observer;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          if (disposed) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const node = entry.target;
            observer.unobserve(node);
            if (revealed.current.has(node)) continue;
            revealed.current.add(node);
            if (node.contains(document.activeElement)) continue;
            const requestedDelay = Number(node.dataset.motionDelay);
            const delay = Number.isFinite(requestedDelay)
              ? Math.max(0, Math.min(140, requestedDelay))
              : 0;
            try {
              const animation = node.animate(
                [
                  { opacity: 0.35, transform: 'translateY(8px)' },
                  { opacity: 1, transform: 'none' },
                ],
                { duration: 440, delay, easing, fill: 'backwards' },
              );
              animations.set(node, animation);
              if (animation) animation.onfinish = () => animations.delete(node);
            } catch {
              // The underlying content is visible without an animation or CSS class.
            }
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -24px 0px' },
      );
    } catch {
      return;
    }
    const focused = (event) => {
      for (const [node, animation] of animations) {
        if (node.contains(event.target)) cancel(node, animation);
      }
    };
    root.addEventListener('focusin', focused);
    targets.forEach((node) => observer.observe(node));
    return () => {
      disposed = true;
      observer.disconnect();
      root.removeEventListener('focusin', focused);
      for (const [node, animation] of animations) cancel(node, animation);
      animations.clear();
    };
  }, [ref, selector, reduced]);
}
