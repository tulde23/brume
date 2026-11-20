import { StyleSheet, useColorScheme } from 'react-native';

/** Direction A, "Morning Fog": mist gray, one deep teal, amber for "check this". */
const light = {
  bg: '#F3F5F7',
  card: '#FFFFFF',
  sunken: '#E6EAEE',
  text: '#1B2430',
  muted: '#4A5563',
  border: '#D9DEE4',
  accent: '#0F6E75',
  accentText: '#FFFFFF',
  warn: '#8A4B00',
  warnLine: '#E8A33D',
  warnBg: '#FFF4E0',
  error: '#B42318',
  errorBg: '#FDECEA',
  ok: '#2F7D4F',
  okBg: '#E3F2E8',
  /** Viewfinder logo: brackets and mist lines. */
  markBracket: '#1B2430',
  markLine: '#0F6E75',
};

/** Same direction after dark: lifted teal so it keeps contrast on near-black. */
const dark: typeof light = {
  bg: '#0E1116',
  card: '#171B22',
  sunken: '#12161C',
  text: '#E8ECF1',
  muted: '#A3ACB9',
  border: '#2A303A',
  accent: '#5FC4CB',
  accentText: '#0E1116',
  warn: '#F5C451',
  warnLine: '#C99A2E',
  warnBg: '#3A2F12',
  error: '#FF8A7E',
  errorBg: '#3D1D1B',
  ok: '#5FD08F',
  okBg: '#15301F',
  markBracket: '#E8ECF1',
  markLine: '#5FC4CB',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Loaded in the root layout from @expo-google-fonts. */
export const fonts = {
  heading: 'SpaceGrotesk_600SemiBold',
  headingBold: 'SpaceGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  /** Numbers in tables and scores, so columns line up. */
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_600SemiBold',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 14, xl: 16 };

export const base = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  h1: { fontSize: 24, fontFamily: fonts.headingBold, letterSpacing: -0.3 },
  h2: { fontSize: 18, fontFamily: fonts.heading },
  body: { fontSize: 15, fontFamily: fonts.body },
  small: { fontSize: 13, fontFamily: fonts.body },
  num: { fontFamily: fonts.monoBold },
});
