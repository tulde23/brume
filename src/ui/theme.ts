import { StyleSheet, useColorScheme } from 'react-native';

/**
 * Direction C, "Scorebook Paper": echoes the paper it reads. Warm stock, ruled
 * lines, pencil-blue ink; problems look like highlighter, errors like red pen.
 */
const light = {
  bg: '#F7F3EA', // paper
  card: '#FFFDF8', // card stock
  sunken: '#ECE6D8',
  text: '#22201C', // ink
  muted: '#5C574E',
  border: '#D8D0BF', // ruled lines
  accent: '#2F5DA8', // pencil blue
  accentText: '#FFFEFC',
  warn: '#6B5200',
  warnLine: '#D4B21F',
  warnBg: '#FFF0A8', // highlighter
  error: '#B42318', // red pen
  errorBg: '#FBE4E0',
  ok: '#2F6F3E',
  okBg: '#E2EFDF',
  /** Viewfinder logo: brackets and lines. */
  markBracket: '#22201C',
  markLine: '#2F5DA8',
  /** League header band (standings, scores, leaders). */
  header: '#22201C',
  headerText: '#F7F3EA',
};

/** The same paper at night: warm charcoal stock, chalky ink, a lifted pencil blue. */
const dark: typeof light = {
  bg: '#1A1814',
  card: '#24211C',
  sunken: '#14120F',
  text: '#EFE8D8',
  muted: '#B4AB98',
  border: '#3B362D',
  accent: '#8FB2EC',
  accentText: '#14120F',
  warn: '#F4D86A',
  warnLine: '#B8971E',
  warnBg: '#40360F',
  error: '#FF8A7E',
  errorBg: '#3E1C19',
  ok: '#86C995',
  okBg: '#1B3122',
  markBracket: '#EFE8D8',
  markLine: '#8FB2EC',
  header: '#0E0D0A',
  headerText: '#EFE8D8',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** IBM Plex, loaded in the root layout from @expo-google-fonts: a plain, technical sans that sits well beside forms. */
export const fonts = {
  heading: 'IBMPlexSans_600SemiBold',
  headingBold: 'IBMPlexSans_700Bold',
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemiBold: 'IBMPlexSans_600SemiBold',
  bodyBold: 'IBMPlexSans_700Bold',
  /** Numbers in tables and scores, like figures in a ledger. */
  mono: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_600SemiBold',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
/** Paper corners: barely rounded. */
export const radius = { sm: 4, md: 6, lg: 8, xl: 10 };

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
