"use client";

import {
  useCallback,
  useLayoutEffect,
  useState,
} from "react";

/**
 * Tracks horizontal scroll on the table container (forward `ref` from {@link Table})
 * so a sticky trailing Actions column can show a stronger left edge once the user scrolls.
 */
export function useStickyActionsColumn() {
  const [tableScrollEl, setTableScrollEl] = useState<HTMLDivElement | null>(
    null,
  );
  const [actionsColumnStacked, setActionsColumnStacked] = useState(false);

  const setTableScrollContainer = useCallback(
    (node: HTMLDivElement | null) => {
      setTableScrollEl(node);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = tableScrollEl;
    if (!el) return;
    const sync = () => {
      setActionsColumnStacked(el.scrollLeft > 0);
    };
    sync();
    const raf = requestAnimationFrame(sync);
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [tableScrollEl]);

  return {
    setTableScrollContainer,
    actionsColumnStacked,
  };
}
