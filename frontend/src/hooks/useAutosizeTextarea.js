import { useLayoutEffect } from 'react';

// Keep long writing in the page's scroll flow, including remote report edits.
export function useAutosizeTextarea(ref, value, context) {
  useLayoutEffect(() => {
    const resize = () => {
      const input = ref.current;
      if (!input || !input.getClientRects().length) return;
      const style = getComputedStyle(input);
      input.style.height = 'auto';
      const border =
        (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      input.style.height =
        Math.max(input.scrollHeight + border, parseFloat(style.minHeight) || 0) + 'px';
    };
    resize();
    // A parent dialog may become visible later in the same layout commit.
    const frame = requestAnimationFrame(resize);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [ref, value, context]);
}
