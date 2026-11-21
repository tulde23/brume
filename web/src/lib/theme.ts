import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const KEY = 'inkstat.theme';

function stored(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** System, light or dark, remembered on this browser. index.html applies it before first paint. */
export function useTheme(): [ThemePref, () => void] {
  const [pref, setPref] = useState<ThemePref>(stored);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* private mode: the choice lasts this visit */
    }
  }, [pref]);
  const next = () => setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));
  return [pref, next];
}
