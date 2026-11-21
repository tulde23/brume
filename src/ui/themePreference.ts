import Storage from 'expo-sqlite/kv-store';
import { Appearance } from 'react-native';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'ui.theme';

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Match the phone',
  light: 'Light',
  dark: 'Dark',
};

export function getThemePreference(): ThemePreference {
  try {
    const v = Storage.getItemSync(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Overrides the phone's light/dark setting for the whole app. useColors() reads
 * useColorScheme(), which follows this override, so every screen switches at once.
 */
export function applyThemePreference(pref: ThemePreference = getThemePreference()): void {
  Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    Storage.setItemSync(KEY, pref);
  } catch {
    // Not saved; the choice still applies until InkStat closes.
  }
  applyThemePreference(pref);
}
