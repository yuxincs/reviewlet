import { useEffect, useState } from 'react';

const storageKey = 'reviewlet.sidebar-width';
export const minSidebarWidth = 280;
const defaultWidth = 360;
const maxSidebarWidth = 560;

export function useSidebarWidth() {
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= minSidebarWidth)
        return Math.min(saved, maxSidebarWidth);
    } catch {
      /* Resizing remains available without persistent storage. */
    }
    return defaultWidth;
  });
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, String(preferredWidth));
      } catch {
        /* Keep the selected width for this session. */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [preferredWidth]);
  // Leave at least half the viewport for the editor on smaller desktops.
  const maxWidth = Math.max(
    minSidebarWidth,
    Math.min(maxSidebarWidth, Math.floor(viewportWidth / 2)),
  );
  return {
    width: Math.min(preferredWidth, maxWidth),
    maxWidth,
    setWidth: (width: number) =>
      setPreferredWidth(Math.max(minSidebarWidth, Math.min(width, maxWidth))),
  };
}
