import { useEffect, useRef, type RefObject } from 'react';

/**
 * Dismisses dropdowns/popovers when a press lands outside `ref`.
 *
 * Attach `ref` to a wrapper that contains BOTH the trigger button and the
 * floating panel: pressing the trigger then counts as an inside click, so the
 * button's own toggle still works (mousedown-outside would otherwise close the
 * panel a millisecond before the click handler re-opens it).
 *
 * The listener is only mounted while `active` is true, and the callback is
 * kept in a ref so callers may pass an inline arrow without re-binding.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  active = true
) {
  const cb = useRef(onOutside);
  cb.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [ref, active]);
}
