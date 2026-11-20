import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fonts, useColors } from './theme';

/** The Viewfinder mark: corner brackets framing three lines of mist. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const c = useColors();
  const bracket = { stroke: c.markBracket, strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  const line = { stroke: c.markLine, strokeWidth: 6, strokeLinecap: 'round' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M6 22 L6 6 L22 6" {...bracket} />
      <Path d="M50 6 L66 6 L66 22" {...bracket} />
      <Path d="M6 50 L6 66 L22 66" {...bracket} />
      <Path d="M66 50 L66 66 L50 66" {...bracket} />
      <Path d="M20 28 L52 28" {...line} />
      <Path d="M16 38 L56 38" {...line} opacity={0.65} />
      <Path d="M24 48 L46 48" {...line} opacity={0.4} />
    </Svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.3 }} accessibilityRole="header" accessibilityLabel="Brume">
      <LogoMark size={size} />
      <Text style={{ fontFamily: fonts.heading, fontSize: size * 0.86, color: c.text, letterSpacing: -0.3 }}>brume</Text>
    </View>
  );
}
