import { useEffect, useState } from 'react';
import { Icon } from './Icon';

type Theme = 'dark' | 'light';
const storageKey = 'reviewlet.theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#031426' : '#f4f6f8');
  }, [theme]);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* The theme still changes when browser storage is unavailable. */
    }
  }

  const label =
    theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}
